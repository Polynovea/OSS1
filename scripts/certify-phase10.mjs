import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createPgClient, createDisposableWorkspace, createAuthenticatedActor, teardownCertification } from './cert-harness.mjs';

const client=await createPgClient();let workspaceId=null;const authUserIds=[],adminUserIds=[];let server=null;
const assert=(c,m)=>{if(!c)throw new Error(m)};
if(!process.env.CMS_CONFIG_ENCRYPTION_KEY)process.env.CMS_CONFIG_ENCRYPTION_KEY=randomBytes(32).toString('base64');
function encryptConfig(value){const key=Buffer.from(process.env.CMS_CONFIG_ENCRYPTION_KEY,'base64');const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64')}
function runWorker(){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/delivery-worker.mjs','--once','--no-maintenance','--queues=p10-cert'],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('close',code=>code===0?resolve({out,err}):reject(new Error(`worker exited ${code}\n${out}\n${err}`)))});}
async function enqueue(actorId,kind,key,payload={},priority=100){const {rows:[r]}=await client.query(`select cms_enqueue_delivery_job($1,$2,$3,$4,$5::jsonb,'{}'::jsonb,now(),$6,3,'p10-cert',null) job`,[workspaceId,actorId,kind,key,JSON.stringify(payload),priority]);return r.job;}
try{
 console.log('=== PHASE 10 FULL DELIVERY OPERATIONS CERTIFICATION ===');
 const ws=await createDisposableWorkspace(client,'p10-full');workspaceId=ws.id;const actor=await createAuthenticatedActor(client,workspaceId,{role:'admin',permissions:['workspace.manage','content.entry.read','content.entry.publish'],emailPrefix:'p10-full'});authUserIds.push(actor.authUserId);adminUserIds.push(actor.adminUserId);
 await client.query(`insert into workspace_locales(workspace_id,locale,enabled,required,is_default) values($1,'en',true,true,true)`,[workspaceId]);
 const api=`p10_${Date.now()}`;const schema={name:'P10 Page',apiKey:api,capability:'publishable',fields:[{key:'title',label:'Title',type:'text',required:true,localized:false,unique:false}],permissions:[]};
 const {rows:[model]}=await client.query(`insert into content_models(workspace_id,name,api_key,status,current_schema_version,settings_json,created_by) values($1,'P10 Page',$2,'active',1,'{"capability":"publishable"}'::jsonb,$3) returning id`,[workspaceId,api,actor.adminUserId]);await client.query(`insert into content_model_versions(content_model_id,version_number,schema_json,schema_hash,change_summary,created_by) values($1,1,$2::jsonb,$3,'p10 cert',$4)`,[model.id,JSON.stringify(schema),randomUUID(),actor.adminUserId]);
 const {rows:[entry]}=await client.query(`insert into content_entries(workspace_id,content_model_id,status,created_by,updated_by) values($1,$2,'approved',$3,$3) returning id`,[workspaceId,model.id,actor.adminUserId]);const {rows:[version]}=await client.query(`insert into content_entry_versions(entry_id,model_schema_version,version_number,data_jsonb,locale,state,created_by,change_summary) values($1,1,1,$2::jsonb,'en','approved',$3,'p10 cert') returning id`,[entry.id,JSON.stringify({title:'Durable worker searchable title'}),actor.adminUserId]);await client.query(`update content_entries set current_draft_version_id=$2 where id=$1`,[entry.id,version.id]);

 console.log('\n--- 1. Automatic producer triggers ---');
 const {rows:[asset]}=await client.query(`insert into assets(workspace_id,storage_provider,storage_key,filename,mime_type,size_bytes,width,height,checksum,created_by) values($1,'local',$2,'hero.png','image/png',1234,1200,800,$3,$4) returning id`,[workspaceId,`p10/${randomUUID()}.png`,randomUUID(),actor.adminUserId]);
 const {rows:autoImage}=await client.query(`select * from delivery_jobs where workspace_id=$1 and kind='image_processing' and payload_json->>'assetId'=$2`,[workspaceId,asset.id]);assert(autoImage.length===1,'Image insert did not produce durable image job');
 const {rows:autoSearch}=await client.query(`select * from delivery_jobs where workspace_id=$1 and kind='search_index' and payload_json->>'entryId'=$2`,[workspaceId,entry.id]);assert(autoSearch.length>=1,'Entry pointer update did not produce durable search job');
 console.log('[PASS] Entry and media mutations automatically create durable jobs.');

 // Remove auto jobs from queues used by this certification; they remain proof of producer behavior and will cascade at teardown.
 const publicationSecret=randomBytes(32).toString('base64url'), webhookSecret=randomBytes(32).toString('base64url');let publishSigned=false,webhookSigned=false;
 server=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks).toString('utf8');const sig=String(req.headers['x-polynovea-signature']||'');if(req.url==='/publish')publishSigned=sig===`sha256=${createHmac('sha256',publicationSecret).update(body).digest('hex')}`;if(req.url==='/hook')webhookSigned=sig===`sha256=${createHmac('sha256',webhookSecret).update(body).digest('hex')}`;res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const {rows:[target]}=await client.query(`insert into publication_targets(workspace_id,name,target_type,config_json_encrypted,active,created_by) values($1,'P10 Local','custom_http',$2,true,$3) returning id`,[workspaceId,encryptConfig({url:`http://127.0.0.1:${port}/publish`,signingSecret:publicationSecret}),actor.adminUserId]);
 // Worker is allowed to target localhost only for this local certification fixture; production creation API requires HTTPS.
 const {rows:[pub]}=await client.query(`insert into publication_jobs(workspace_id,target_id,entry_id,version_id,idempotency_key) values($1,$2,$3,$4,$5) returning id`,[workspaceId,target.id,entry.id,version.id,`p10-pub-${randomUUID()}`]);
 const {rows:[sub]}=await client.query(`insert into webhook_subscriptions(workspace_id,name,endpoint_url,event_filters,signing_secret_hash,signing_secret_encrypted,active,created_by) values($1,'P10 Hook',$2,array['*'],$3,$4,true,$5) returning id`,[workspaceId,`http://127.0.0.1:${port}/hook`,createHash('sha256').update(webhookSecret).digest('hex'),encryptConfig({secret:webhookSecret}),actor.adminUserId]);const {rows:[delivery]}=await client.query(`insert into webhook_deliveries(subscription_id,event_type,event_id,payload_json) values($1,'p10.test',$2,'{"hello":"world"}'::jsonb) returning id`,[sub.id,randomUUID()]);

 const {rows:[release]}=await client.query(`insert into releases(workspace_id,name,status,scheduled_for,created_by,approved_by,approved_at,updated_by) values($1,'P10 Scheduled','scheduled',now()-interval '1 minute',$2,$2,now(),$2) returning id`,[workspaceId,actor.adminUserId]);await client.query(`insert into release_items(release_id,entry_id,entry_version_id) values($1,$2,$3)`,[release.id,entry.id,version.id]);await client.query(`insert into release_locale_targets(release_id,workspace_id,locale,required) values($1,$2,'en',true)`,[release.id,workspaceId]);

 console.log('\n--- 2. Seven adapter jobs + idempotent audit ---');
 const jobs=[];
 jobs.push(await enqueue(actor.adminUserId,'scheduled_release',`cert-schedule-${release.id}`,{releaseId:release.id,actorId:actor.adminUserId},10));
 jobs.push(await enqueue(actor.adminUserId,'publish',`cert-publish-${pub.id}`,{publicationJobId:pub.id},20));
 jobs.push(await enqueue(actor.adminUserId,'webhook',`cert-webhook-${delivery.id}`,{webhookDeliveryId:delivery.id},30));
 const searchJob=await enqueue(actor.adminUserId,'search_index',`cert-search-${entry.id}`,{entryId:entry.id,versionId:version.id},40);jobs.push(searchJob);
 const duplicate=await enqueue(actor.adminUserId,'search_index',`cert-search-${entry.id}`,{entryId:entry.id,versionId:version.id},40);assert(duplicate.id===searchJob.id,'Idempotent enqueue returned a different job');
 jobs.push(await enqueue(actor.adminUserId,'image_processing',`cert-image-${asset.id}`,{assetId:asset.id},50));
 jobs.push(await enqueue(actor.adminUserId,'health_scan',`cert-health-${workspaceId}`,{workspaceId},60));
 jobs.push(await enqueue(actor.adminUserId,'analytics_sync',`cert-analytics-${randomUUID()}`,{connectorId:randomUUID()},70));
 const {rows:[auditCount]}=await client.query(`select count(*)::int c from platform_audit_events where workspace_id=$1 and action='delivery.job.enqueued' and entity_id=$2`,[workspaceId,searchJob.id]);assert(auditCount.c===1,`Idempotent enqueue emitted ${auditCount.c} audit events`);
 console.log('[PASS] All seven job kinds queued; duplicate enqueue produced one job and one enqueue audit.');

 console.log('\n--- 3. Independent worker execution ---');
 const worker=await runWorker();console.log(worker.out.trim());
 const ids=jobs.map(j=>j.id);const {rows:states}=await client.query(`select id,kind,status,attempt_count from delivery_jobs where id=any($1::uuid[]) order by kind`,[ids]);assert(states.length===7,'Expected seven certified jobs');for(const state of states)assert(state.status==='succeeded',`${state.kind} ended in ${state.status}`);
 const {rows:attempts}=await client.query(`select job_id,outcome,latency_ms,worker_id from delivery_job_attempts where job_id=any($1::uuid[])`,[ids]);assert(attempts.length===7&&attempts.every(a=>a.outcome==='succeeded'&&a.worker_id),'Attempt history incomplete');
 console.log('[PASS] External worker claimed and completed all seven adapter kinds with attempt history.');

 console.log('\n--- 4. Adapter side effects + signatures ---');
 const {rows:[relState]}=await client.query(`select status from releases where id=$1`,[release.id]);assert(relState.status==='published','Scheduled release was not published');
 const {rows:[search]}=await client.query(`select search_text,status from content_search_documents where entry_id=$1`,[entry.id]);assert(search.search_text.includes('Durable worker searchable title'),'Search adapter did not index entry');
 const {rows:[assetState]}=await client.query(`select metadata_json,width,height from assets where id=$1`,[asset.id]);assert(assetState.metadata_json?.processing?.status==='ready'&&assetState.width===1200,'Image adapter did not record processing metadata');
 const {rows:[finding]}=await client.query(`select finding_code from content_health_findings where workspace_id=$1 and entity_type='entry' and entity_id=$2 and finding_code='missing_owner'`,[workspaceId,entry.id]);assert(Boolean(finding),'Health adapter did not materialize missing_owner finding');
 const {rows:[pubState]}=await client.query(`select status from publication_jobs where id=$1`,[pub.id]);const {rows:[hookState]}=await client.query(`select status from webhook_deliveries where id=$1`,[delivery.id]);assert(pubState.status==='succeeded'&&hookState.status==='succeeded','HTTP adapters did not succeed');assert(publishSigned,'Publication payload signature was invalid');assert(webhookSigned,'Webhook payload signature was invalid');
 const {rows:health}=await client.query(`select destination_kind,health_state from delivery_destination_health where workspace_id=$1`,[workspaceId]);assert(health.some(h=>h.destination_kind==='publication_target'&&h.health_state==='healthy')&&health.some(h=>h.destination_kind==='webhook_subscription'&&h.health_state==='healthy'),'Destination health was not recorded');
 console.log('[PASS] Release/search/image/health/HTTP side effects and HMAC signatures certified.');

 console.log('\nPHASE 10 FULL DELIVERY OPERATIONS CERTIFICATION: ALL PASSED');
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));
 if(workspaceId){await client.query('delete from releases where workspace_id=$1',[workspaceId]).catch(()=>{});await client.query('delete from content_entries where workspace_id=$1',[workspaceId]).catch(()=>{});await client.query('delete from content_models where workspace_id=$1',[workspaceId]).catch(()=>{});}
 await teardownCertification({client,workspaceId,authUserIds,adminUserIds});await client.end();
}
