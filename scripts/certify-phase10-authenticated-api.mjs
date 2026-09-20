import { randomUUID } from 'node:crypto';
import { createPgClient, createDisposableWorkspace, createAuthenticatedActor, teardownCertification } from './cert-harness.mjs';
const client=await createPgClient();const BASE=process.env.CMS_CERT_BASE_URL||'http://localhost:3000';let workspaceId=null;const authUserIds=[],adminUserIds=[];const assert=(c,m)=>{if(!c)throw new Error(m)};
async function call(path,init={}){const response=await fetch(BASE+path,init);let body=null;try{body=await response.json()}catch{}return{response,body}}
try{
 console.log('=== PHASE 10 AUTHENTICATED OPERATIONS API CERTIFICATION ===');
 const ws=await createDisposableWorkspace(client,'p10-http');workspaceId=ws.id;const admin=await createAuthenticatedActor(client,workspaceId,{role:'admin',permissions:['content.entry.read','content.entry.publish'],emailPrefix:'p10-http-admin'});const viewer=await createAuthenticatedActor(client,workspaceId,{role:'viewer',permissions:['content.entry.read'],emailPrefix:'p10-http-viewer'});for(const a of [admin,viewer]){authUserIds.push(a.authUserId);adminUserIds.push(a.adminUserId)}
 const {rows:[job]}=await client.query(`select cms_enqueue_delivery_job($1,$2,'health_scan',$3,'{}'::jsonb,'{}'::jsonb,now(),100,3,'p10-http',null) job`,[workspaceId,admin.adminUserId,`p10-http-${randomUUID()}`]);
 console.log('\n--- 1. Read/write authorization boundary ---');
 let r=await call('/api/operations/jobs');assert(r.response.status===401,`Expected unauthenticated 401, got ${r.response.status}`);
 r=await call('/api/operations/jobs',{headers:viewer.headers});assert(r.response.status===200&&r.body?.data?.some?.(x=>x.id===job.job.id),'Authorized job list did not include fixture');
 r=await call(`/api/operations/jobs/${job.job.id}/cancel`,{method:'POST',headers:viewer.headers});assert(r.response.status===403,`Viewer cancel should be 403, got ${r.response.status}`);
 r=await call(`/api/operations/jobs/${job.job.id}/cancel`,{method:'POST',headers:admin.headers});assert(r.response.status===200&&r.body?.success,'Admin cancel failed');
 console.log('[PASS] Operations read/write 401/403/200 boundaries certified.');

 console.log('\n--- 2. Replay + job detail ---');
 r=await call(`/api/operations/jobs/${job.job.id}/replay`,{method:'POST',headers:admin.headers});assert(r.response.status===201&&r.body?.success,'Replay API failed');const replayId=r.body.data.id;assert(replayId&&replayId!==job.job.id,'Replay did not create a new job');
 r=await call(`/api/operations/jobs/${replayId}`,{headers:viewer.headers});assert(r.response.status===200&&r.body?.data?.job?.replay_of_job_id===job.job.id,'Job detail/replay lineage missing');
 console.log('[PASS] Manual recovery APIs preserve replay lineage.');

 console.log('\n--- 3. Webhook inspector controls ---');
 const {rows:[sub]}=await client.query(`insert into webhook_subscriptions(workspace_id,name,endpoint_url,event_filters,signing_secret_hash,signing_secret_encrypted,active,created_by) values($1,'HTTP Cert','https://example.invalid/hook','{}',$2,'fixture',true,$3) returning id`,[workspaceId,randomUUID(),admin.adminUserId]);
 r=await call('/api/operations/webhooks',{headers:viewer.headers});assert(r.response.status===200&&r.body?.data?.subscriptions?.some?.(x=>x.id===sub.id),'Webhook inspector did not list subscription');
 r=await call(`/api/operations/webhooks/${sub.id}`,{method:'PATCH',headers:viewer.headers,body:JSON.stringify({operation:'set_active',active:false})});assert(r.response.status===403,'Viewer webhook mutation should be forbidden');
 r=await call(`/api/operations/webhooks/${sub.id}`,{method:'PATCH',headers:admin.headers,body:JSON.stringify({operation:'set_active',active:false})});assert(r.response.status===200&&r.body?.success,'Admin disable webhook failed');const {rows:[state]}=await client.query('select active from webhook_subscriptions where id=$1',[sub.id]);assert(state.active===false,'Webhook disable was not persisted');
 console.log('[PASS] Webhook inspector read/control permissions and disable action certified.');

 console.log('\n--- 4. Destination health API ---');
 await client.query(`select cms_record_destination_health($1,'webhook_subscription',$2,false,25,'HTTP_500','fixture failure',false)`,[workspaceId,sub.id]);r=await call('/api/operations/health',{headers:viewer.headers});assert(r.response.status===200&&r.body?.data?.some?.(x=>x.destination_id===sub.id&&x.consecutive_failures===1),'Destination health API did not expose failure state');
 console.log('[PASS] Destination health is visible to governed operators.');
 console.log('\nPHASE 10 AUTHENTICATED OPERATIONS API CERTIFICATION: ALL PASSED');
}finally{await teardownCertification({client,workspaceId,authUserIds,adminUserIds});await client.end()}
