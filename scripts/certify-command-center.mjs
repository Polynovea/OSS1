import { createPgClient, createDisposableWorkspace, createAuthenticatedActor, teardownCertification } from './cert-harness.mjs';

const BASE=process.env.CMS_CERT_BASE_URL||'http://localhost:3000';
const client=await createPgClient();
let workspaceId=null;
const authUserIds=[];
const adminUserIds=[];
const assert=(condition,message)=>{if(!condition)throw new Error(message)};

async function api(path,headers={}){
  const response=await fetch(BASE+path,{headers});
  const body=await response.json().catch(()=>null);
  return {status:response.status,body};
}

try{
  console.log('=== COMMAND CENTER LIVE SNAPSHOT CERTIFICATION ===');
  const ws=await createDisposableWorkspace(client,'command-center');workspaceId=ws.id;
  const viewer=await createAuthenticatedActor(client,workspaceId,{role:'viewer',permissions:['workspace.read'],emailPrefix:'command-center-viewer'});
  authUserIds.push(viewer.authUserId);adminUserIds.push(viewer.adminUserId);

  const noAuth=await api('/api/command-center');
  assert(noAuth.status===401,`Expected unauthenticated 401, got ${noAuth.status}`);

  const result=await api('/api/command-center',viewer.headers);
  assert(result.status===200,`Command Center snapshot failed ${result.status}: ${JSON.stringify(result.body)}`);
  const data=result.body?.data;
  assert(data&&['healthy','attention','blocked'].includes(data.readiness),'Readiness state missing/invalid');
  assert(typeof data.content?.models==='number'&&typeof data.content?.entries==='number','Content aggregate missing');
  assert(typeof data.delivery?.queued==='number'&&typeof data.delivery?.deadLetter==='number','Delivery aggregate missing');
  assert(typeof data.assurance?.open==='number','Assurance aggregate missing');
  assert(typeof data.infrastructure?.environments?.total==='number'&&typeof data.infrastructure?.connections?.total==='number','Infrastructure aggregate missing');
  assert(Array.isArray(data.attention)&&Array.isArray(data.recentActivity),'Attention/activity arrays missing');
  assert(data.content.models===0&&data.content.entries===0,'Disposable workspace snapshot leaked content from another workspace');
  assert(data.infrastructure.environments.total===0&&data.infrastructure.connections.total===0,'Disposable workspace snapshot leaked infrastructure from another workspace');

  console.log('[PASS] Auth boundary, workspace isolation, aggregate shape, and empty-workspace readiness certified.');
  console.log('COMMAND CENTER CERTIFICATION: ALL PASSED');
}finally{
  await teardownCertification({client,workspaceId,authUserIds,adminUserIds});
  await client.end();
}
