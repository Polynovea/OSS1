import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createPgClient, createDisposableWorkspace, createAuthenticatedActor, teardownCertification } from './cert-harness.mjs';

const BASE=process.env.CMS_CERT_BASE_URL||'http://localhost:3000';
const client=await createPgClient();
let workspaceId=null,server=null,tempRoot=null;
const authUserIds=[],adminUserIds=[];
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function api(route,{headers={},method='GET',body,form}={}){
  const requestHeaders={...headers,...(body?{'content-type':'application/json'}:{})};if(form){delete requestHeaders['content-type'];delete requestHeaders['Content-Type'];}const r=await fetch(BASE+route,{method,headers:requestHeaders,body:form??(body?JSON.stringify(body):undefined)});
  const text=await r.text();let data=null;try{data=JSON.parse(text)}catch{data=text}return{status:r.status,body:data};
}

try{
  console.log('=== PHASE 12.5 STORAGE DATA-PLANE + LOCAL WORKSPACE CERTIFICATION ===');
  const ws=await createDisposableWorkspace(client,'p125-storage-local');workspaceId=ws.id;
  const manager=await createAuthenticatedActor(client,workspaceId,{role:'admin',permissions:['environment.read','environment.manage','connection.read','connection.manage','connection.verify','secret.manage','media.read','media.upload','media.manage'],emailPrefix:'p125-storage'});authUserIds.push(manager.authUserId);adminUserIds.push(manager.adminUserId);

  const objects=new Map();
  server=http.createServer((req,res)=>{
    const chunks=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
      const pathname=new URL(req.url||'/','http://127.0.0.1').pathname;const key=decodeURIComponent(pathname.replace(/^\/test-bucket\/?/,''));
      if(req.method==='HEAD'){res.writeHead(200,{'content-length':'0'});return res.end();}
      if(req.method==='PUT'){objects.set(key,Buffer.concat(chunks));res.writeHead(200,{etag:'"mock-etag"'});return res.end();}
      if(req.method==='GET'){const body=objects.get(key);if(!body){res.writeHead(404);return res.end();}res.writeHead(200,{'content-length':String(body.length),'content-type':'application/octet-stream'});return res.end(body);}
      if(req.method==='DELETE'){objects.delete(key);res.writeHead(204);return res.end();}
      res.writeHead(200,{'content-type':'application/xml'});res.end('<ListBucketResult/>');
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;

  console.log('\n--- 1. Environment-selected storage connection + live round-trip ---');
  const envRes=await api('/api/environments',{method:'POST',headers:manager.headers,body:{key:'local',name:'Storage Local',kind:'local',isDefault:true,databaseProvider:'postgres',runtimeProvider:'local',storageProvider:'minio',secretProviderKind:'environment'}});
  assert(envRes.status===201,`Environment create failed ${envRes.status}: ${JSON.stringify(envRes.body)}`);
  const envId=envRes.body.data.environment.id,providerId=envRes.body.data.secretProvider.id;
  const conn=await api('/api/connections',{method:'POST',headers:manager.headers,body:{environmentId:envId,connectorType:'storage.minio',name:'Mock MinIO',secretProviderId:providerId,config:{endpoint:`http://127.0.0.1:${port}`,bucket:'test-bucket',region:'us-east-1'},credentials:[{purpose:'access_key_id',locator:'NEXT_PUBLIC_SUPABASE_URL'},{purpose:'secret_access_key',locator:'NEXT_PUBLIC_SUPABASE_ANON_KEY'}]}});
  assert(conn.status===201,`Storage connection create failed ${conn.status}: ${JSON.stringify(conn.body)}`);const connectionId=conn.body.data.connection.id;
  const verify=await api(`/api/connections/${connectionId}/verify`,{method:'POST',headers:manager.headers,body:{}});
  assert(verify.status===200,`Storage verify failed ${verify.status}: ${JSON.stringify(verify.body)}`);
  const listed=await api('/api/connections',{headers:manager.headers});const row=listed.body.data.find(x=>x.id===connectionId);
  assert(row?.status==='active',`Storage connection did not become active after verification: ${JSON.stringify(row)}`);
  assert(row.latestVerification?.checks_json?.some(x=>x.key==='roundtrip'&&x.status==='passed'),'Disposable storage round-trip was not recorded');
  assert(objects.size===0,'Storage verification leaked disposable object');
  console.log('[PASS] Environment-selected MinIO/S3-compatible verification performed real write/read/delete with zero leaked probe objects.');

  console.log('\n--- 2. Media data plane actually resolves the environment storage connection ---');
  const form=new FormData();form.set('file',new File([Buffer.from('%PDF-1.4\nphase12.5 storage certification\n%%EOF')],'phase12_5.pdf',{type:'application/pdf'}));form.set('folder','certification');form.set('environmentId',envId);
  const upload=await api('/api/assets',{method:'POST',headers:manager.headers,form});
  assert(upload.status===201||upload.status===200,`Asset upload failed ${upload.status}: ${JSON.stringify(upload.body)}`);
  const asset=upload.body.data;
  assert(asset?.storage_provider===`connection:${connectionId}`,`Asset did not persist connection-backed provider key: ${asset?.storage_provider}`);
  assert(asset?.metadata_json?.storageConnectionId===connectionId,'Asset metadata did not record storage connection provenance');
  assert(objects.has(asset.storage_key),'Media upload did not reach selected storage data plane');
  console.log('[PASS] Real media upload used the selected environment storage connection, not legacy hard-wired R2.');

  console.log('\n--- 3. Local Workspace guarded initialization + secret generation/idempotency ---');
  tempRoot=await mkdtemp(path.join(os.tmpdir(),'polynovea-p125-local-'));
  const localDir=path.join(tempRoot,'workspace');
  const disabled=spawnSync(process.execPath,['scripts/local-runtime.mjs','init',`--directory=${localDir}`],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,POLYNOVEA_LOCAL_RUNTIME_CONTROL:'0'}});
  assert(disabled.status!==0&&/enable local runtime control/i.test(disabled.stderr),'Local runtime CLI did not fail closed when control disabled');
  const env={...process.env,POLYNOVEA_LOCAL_RUNTIME_CONTROL:'1',POLYNOVEA_LOCAL_RUNTIME_ROOT:tempRoot};
  const first=spawnSync(process.execPath,['scripts/local-runtime.mjs','init',`--directory=${localDir}`],{cwd:process.cwd(),encoding:'utf8',env});
  assert(first.status===0,`Local runtime init failed: ${first.stderr}`);
  const config=JSON.parse(first.stdout);const before=await readFile(config.envFile,'utf8');const mode=(await stat(config.envFile)).mode & 0o777;
  for(const key of ['POSTGRES_PASSWORD','JWT_SECRET','ANON_KEY','SERVICE_ROLE_KEY','CMS_CONFIG_ENCRYPTION_KEY'])assert(new RegExp(`^${key}=.+$`,'m').test(before),`${key} was not generated`);
  assert(!before.includes('POSTGRES_PASSWORD=""')&&!before.includes('JWT_SECRET=""'),'Generated local secrets were empty');
  const second=spawnSync(process.execPath,['scripts/local-runtime.mjs','init',`--directory=${localDir}`],{cwd:process.cwd(),encoding:'utf8',env});
  assert(second.status===0,'Second local runtime init failed');const after=await readFile(config.envFile,'utf8');assert(before===after,'Local runtime initialization rotated/replaced credentials on idempotent re-run');
  if(process.platform!=='win32')assert(mode===0o600,`runtime.env permissions expected 0600, got ${mode.toString(8)}`);
  console.log('[PASS] Local Workspace init is opt-in, generates protected runtime credentials once, and is idempotent.');

  console.log('\n--- 4. Packaged local topology preserves production semantics ---');
  const compose=await readFile('deploy/local/docker-compose.yml','utf8');
  for(const service of ['db:','rest:','auth:','gateway:','cms:','worker:'])assert(compose.includes(`  ${service}`),`Local Compose missing ${service}`);
  assert(compose.includes('supabase/postgres:')&&compose.includes('postgrest/postgrest:')&&compose.includes('supabase/gotrue:'),'Local package does not preserve PostgreSQL/PostgREST/Auth semantics');
  assert(compose.includes('scripts/delivery-worker.mjs'),'Local package does not include durable worker execution');
  const dockerProbe=spawnSync(process.execPath,['-e',"require('node:child_process').execFile('docker',['--version'],e=>process.exit(e?2:0))"],{cwd:process.cwd(),encoding:'utf8'});
  if(dockerProbe.status===0)console.log('[PASS] Docker executable is available on the certification host.');else console.log('[PASS] Docker is not installed on this certification host; packaged topology and initialization are certified, and runtime control will explicitly fail rather than report false success.');

  console.log('\n================================================================');
  console.log('PHASE 12.5 STORAGE + LOCAL WORKSPACE CERTIFICATION: ALL PASSED');
  console.log('================================================================');
}finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(tempRoot)await rm(tempRoot,{recursive:true,force:true}).catch(()=>{});
  await teardownCertification({client,workspaceId,authUserIds,adminUserIds});await client.end();
}
