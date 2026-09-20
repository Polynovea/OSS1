import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createPgClient, createDisposableWorkspace, createAuthenticatedActor, teardownCertification } from './cert-harness.mjs';
import { PolynoveaCMS } from '../packages/cms-sdk/dist/index.js';

const BASE=process.env.CMS_CERT_BASE_URL||'http://localhost:3000';
const client=await createPgClient(); let workspaceId=null; const authUserIds=[]; const adminUserIds=[];
const assert=(c,m)=>{if(!c)throw new Error(m)};
let rawToken='';
try{
  console.log('=== PHASE 12 FULL DEVELOPER PLATFORM CERTIFICATION ===');
  const ws=await createDisposableWorkspace(client,'p12-full'); workspaceId=ws.id;
  const actor=await createAuthenticatedActor(client,workspaceId,{role:'admin',permissions:[],emailPrefix:'p12-full'}); authUserIds.push(actor.authUserId); adminUserIds.push(actor.adminUserId);
  rawToken=`pnv_${randomUUID()}_${randomUUID()}`; const hash=createHash('sha256').update(rawToken).digest('hex');
  const scopes=['content.read','content.write','content.publish','media.read','media.write','schema.read','schema.write','releases.read','releases.write','analytics.read'];
  await client.query(`insert into developer_api_tokens(workspace_id,name,token_prefix,token_hash,scopes,allowed_models,rate_limit_per_minute,expires_at,created_by) values($1,$2,$3,$4,$5::text[],'{}',10000,now()+interval '2 hours',$6)`,[workspaceId,`full-cert-${randomUUID().slice(0,8)}`,rawToken.slice(0,12),hash,scopes,actor.adminUserId]);
  const sdk=new PolynoveaCMS({baseUrl:BASE,token:rawToken});

  console.log('\n--- 1. Stable API + SDK model/record lifecycle ---');
  const apiKey=`cert_article_${randomUUID().replaceAll('-','').slice(0,8)}`;
  const schema={name:'Phase 12 Certification Article',apiKey,capability:'publishable',fields:[{key:'title',label:'Title',type:'text',required:true},{key:'body',label:'Body',type:'text',required:false}]};
  const created=await sdk.models.create(schema); const model=created.model; assert(model?.api_key===apiKey,'SDK model create failed');
  const entryCreated=await sdk.entries.create(apiKey,{title:'Phase 12 certification article',body:'Developer API end-to-end certification'}); const entryId=entryCreated.entry.id; const versionId=entryCreated.version.id; assert(entryId&&versionId,'SDK entry create failed');
  const updated=await sdk.entries.update(entryId,{title:'Phase 12 certification article updated',body:'Developer API end-to-end certification'} ,{expectedVersionNumber:1}); assert(updated.version.version_number===2,'SDK optimistic draft update failed');
  await client.query(`insert into content_routes(workspace_id,entry_id,locale,path,title,is_canonical,status,indexing_policy,sitemap_included) values($1,$2,'en',$3,'Certification',true,'active','index',true)`,[workspaceId,entryId,`/p12-${randomUUID().slice(0,8)}`]);
  await client.query(`update content_entries set status='approved' where id=$1`,[entryId]);
  const published=await sdk.entries.publish(entryId); assert(published.entry?.status==='published','SDK publish API did not publish');
  const publishedRead=await sdk.published.get(apiKey,entryId); assert(publishedRead.id===entryId,'Published-content API did not return published entry');
  console.log('[PASS] SDK exercised model create, entry create/update, publish and published read through /api/v1.');

  console.log('\n--- 2. Schema-as-code drift / dry-run / promotion ---');
  const bundle=await sdk.schema.bundle('development'); const bm=bundle.models.find(m=>m.apiKey===apiKey); assert(bm,'Schema bundle missing model');
  bm.schema.fields=[...bm.schema.fields,{key:'summary',label:'Summary',type:'text',required:false}];
  const plan=await sdk.schema.dryRun(bundle,'staging'); const item=plan.items.find(i=>i.apiKey===apiKey); assert(item?.action==='update'&&item?.classification==='SAFE','Schema dry-run did not classify safe additive change');
  const promotion=await sdk.schema.promote(bundle,{targetEnvironment:'staging'}); assert(promotion.applied===true,'Schema promotion was not applied');
  const {rows:[m2]}=await client.query(`select current_schema_version from content_models where id=$1`,[model.id]); assert(m2.current_schema_version===2,'Schema version did not advance');
  const runs=await sdk.schema.runs(); assert(runs.some(r=>r.operation==='dry_run')&&runs.some(r=>['promotion','push'].includes(r.operation)),'Schema run ledger incomplete');
  console.log('[PASS] Drift plan, dry-run, promotion, version history and run ledger certified.');

  console.log('\n--- 3. Governed import + full export ---');
  const dry=await sdk.imports.dryRun({model:apiKey,format:'csv',content:'title,body\nImported certification row,Imported through Phase 12'}); assert(dry.total===1&&dry.valid===1&&dry.invalid===0,'Import dry-run failed');
  const committed=await sdk.imports.commit({model:apiKey,format:'csv',content:'title,body\nImported certification row,Imported through Phase 12'}); assert(committed.succeeded===1&&committed.failed===0,'Import commit did not create record');
  const exported=await sdk.exportWorkspace(); assert(exported.format==='polynovea-cms-export'&&exported.schema?.models?.length>=1&&exported.content?.entries?.length>=2,'Full workspace export incomplete');
  console.log('[PASS] Governed CSV import and portable full export certified.');

  console.log('\n--- 4. CLI against real service-token API ---');
  const env={...process.env,POLYNOVEA_CMS_URL:BASE,POLYNOVEA_CMS_TOKEN:rawToken};
  const cli=(args)=>spawnSync(process.execPath,['scripts/polynovea-cms.mjs',...args],{cwd:process.cwd(),env,encoding:'utf8',timeout:30000});
  let r=cli(['model','pull',apiKey]); assert(r.status===0,`CLI model pull failed: ${r.stderr}`); const pulled=JSON.parse(r.stdout); assert(pulled.models?.[0]?.apiKey===apiKey||pulled.apiKey===apiKey,'CLI model pull returned wrong model');
  r=cli(['entries','list','--model',apiKey]); assert(r.status===0,`CLI entries list failed: ${r.stderr}`); const listed=JSON.parse(r.stdout); assert(Array.isArray(listed)&&listed.length>=2,'CLI entries list returned no records');
  r=cli(['migrations','history']); assert(r.status===0,`CLI migration history failed: ${r.stderr}`); const history=JSON.parse(r.stdout); assert(Array.isArray(history)&&history.length>=2,'CLI schema history unavailable');
  console.log('[PASS] CLI executed model, entry and migration operations against the real /api/v1 service-token boundary.');

  console.log('\n--- 5. Token scope/model restriction + OpenAPI discoverability ---');
  const restrictedRaw=`pnv_${randomUUID()}_${randomUUID()}`; const restrictedHash=createHash('sha256').update(restrictedRaw).digest('hex');
  await client.query(`insert into developer_api_tokens(workspace_id,name,token_prefix,token_hash,scopes,allowed_models,rate_limit_per_minute,created_by) values($1,$2,$3,$4,array['content.read'],array['not_${apiKey}'],100,$5)`,[workspaceId,`restricted-${randomUUID().slice(0,8)}`,restrictedRaw.slice(0,12),restrictedHash,actor.adminUserId]);
  const forbidden=await fetch(`${BASE}/api/v1/content/${apiKey}`,{headers:{authorization:`Bearer ${restrictedRaw}`}}); assert(forbidden.status===403,'Model restriction did not return 403');
  const openapi=await sdk.openApi(); assert(openapi.openapi==='3.1.0'&&openapi.paths['/api/v1/entries']&&openapi.paths['/api/v1/schema/promote']&&openapi.paths['/api/v1/imports']&&openapi.paths['/api/v1/export'],'OpenAPI does not expose Phase 12 automation surface');
  console.log('[PASS] Model restriction and OpenAPI discoverability certified.');

  console.log('\nPHASE 12 FULL DEVELOPER PLATFORM CERTIFICATION: ALL PASSED');
} finally {
  if(workspaceId){await client.query('delete from releases where workspace_id=$1',[workspaceId]).catch(()=>{});await client.query('delete from content_entries where workspace_id=$1',[workspaceId]).catch(()=>{});await client.query('delete from content_models where workspace_id=$1',[workspaceId]).catch(()=>{});}
  await teardownCertification({client,workspaceId,authUserIds,adminUserIds}); await client.end();
}
