import { randomUUID } from 'node:crypto';
import { createPgClient, createDisposableWorkspace, createAuthenticatedActor, teardownCertification } from './cert-harness.mjs';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const client = await createPgClient();
let workspaceId = null; const authUserIds=[]; const adminUserIds=[];
try {
  console.log('=== PHASE 11 FOUNDATION CERTIFICATION ===');
  const ws = await createDisposableWorkspace(client,'p11'); workspaceId=ws.id;
  const actor = await createAuthenticatedActor(client, workspaceId, { role:'admin', permissions:['workspace.manage','content.entry.read','content.entry.edit','media.read'], emailPrefix:'p11' });
  authUserIds.push(actor.authUserId); adminUserIds.push(actor.adminUserId);

  const apiKey=`p11_${Date.now()}`;
  const schema={name:'P11 Article',apiKey,capability:'publishable',fields:[{key:'title',label:'Title',type:'text',required:true,localized:false,unique:false}]};
  const {rows:[model]}=await client.query(`insert into content_models(workspace_id,name,api_key,status,current_schema_version,settings_json,created_by) values($1,'P11 Article',$2,'active',1,'{"capability":"publishable"}'::jsonb,$3) returning id`,[workspaceId,apiKey,actor.adminUserId]);
  await client.query(`insert into content_model_versions(content_model_id,version_number,schema_json,schema_hash,change_summary,created_by) values($1,1,$2::jsonb,$3,'phase11 cert',$4)`,[model.id,JSON.stringify(schema),randomUUID(),actor.adminUserId]);
  const {rows:[entry]}=await client.query(`insert into content_entries(workspace_id,content_model_id,status,created_by,updated_by) values($1,$2,'draft',$3,$3) returning id`,[workspaceId,model.id,actor.adminUserId]);
  const {rows:[version]}=await client.query(`insert into content_entry_versions(entry_id,model_schema_version,version_number,data_jsonb,locale,state,created_by,change_summary) values($1,1,1,$2::jsonb,'en','draft',$3,'phase11 cert') returning id`,[entry.id,JSON.stringify({title:'Orbital Behaviour Intelligence'}),actor.adminUserId]);
  await client.query(`update content_entries set current_draft_version_id=$2 where id=$1`,[entry.id,version.id]);
  await client.query(`insert into content_search_documents(entry_id,workspace_id,version_id,content_model_id,locale,status,author_id,search_text) values($1,$2,$3,$4,'en','draft',$5,'Orbital Behaviour Intelligence research framework')`,[entry.id,workspaceId,version.id,model.id,actor.adminUserId]);

  console.log('\n--- 1. Ranked PostgreSQL search ---');
  const {rows:search}=await client.query(`select * from cms_search_content_ranked($1,$2,null,null,null,null,null,null,null,50,0)`,[workspaceId,'orbital intelligence']);
  assert(search.length===1 && search[0].entry_id===entry.id,'Ranked search did not return expected entry');
  assert(Number(search[0].rank)>0 || Number(search[0].similarity)>0,'Ranked search produced no relevance score');
  console.log('[PASS] FTS/trigram ranked search returns the expected workspace entry.');

  console.log('\n--- 2. Saved-search ownership ---');
  const {rows:[saved]}=await client.query(`insert into content_saved_searches(workspace_id,owner_id,name,query_json) values($1,$2,'Orbital search',$3::jsonb) returning id`,[workspaceId,actor.adminUserId,JSON.stringify({q:'orbital'})]);
  let duplicateRejected=false; try{await client.query(`insert into content_saved_searches(workspace_id,owner_id,name,query_json) values($1,$2,'Orbital search','{}'::jsonb)`,[workspaceId,actor.adminUserId]);}catch{duplicateRejected=true;}
  assert(saved.id && duplicateRejected,'Saved-search uniqueness/ownership invariant failed');
  console.log('[PASS] Saved-search ownership/name uniqueness enforced.');

  console.log('\n--- 3. Analytics freshness state ---');
  const {rows:[connector]}=await client.query(`insert into analytics_connectors(workspace_id,provider,name,credential_mode,active,created_by) values($1,'ga4','GA4','environment',true,$2) returning id`,[workspaceId,actor.adminUserId]);
  await client.query(`insert into analytics_sync_state(connector_id,workspace_id,status,last_success_at,fresh_through) values($1,$2,'fresh',now(),current_date-1)`,[connector.id,workspaceId]);
  const {rows:[state]}=await client.query(`select status,fresh_through from analytics_sync_state where connector_id=$1`,[connector.id]);
  assert(state.status==='fresh' && state.fresh_through,'Analytics freshness state did not persist');
  console.log('[PASS] Connector identity and explicit data freshness state persist independently from snapshots.');

  console.log('\n--- 4. Health finding materialization/reopen ---');
  const fp=`cert:${entry.id}:missing_owner`;
  const {rows:[first]}=await client.query(`select (cms_upsert_health_finding($1,'entry',$2,'missing_owner','warning',$3,'Missing owner','No owner','{}'::jsonb)).*`,[workspaceId,entry.id,fp]);
  await client.query(`update content_health_findings set state='resolved',resolved_at=now() where id=$1`,[first.id]);
  const {rows:[reopened]}=await client.query(`select (cms_upsert_health_finding($1,'entry',$2,'missing_owner','blocking',$3,'Missing owner again','Still missing','{"repeat":true}'::jsonb)).*`,[workspaceId,entry.id,fp]);
  assert(reopened.id===first.id && reopened.state==='open' && reopened.severity==='blocking' && reopened.resolved_at===null,'Health finding did not reopen atomically');
  console.log('[PASS] Stable finding fingerprint reopens resolved findings without duplicating them.');

  console.log('\n--- 5. Remediation queue ---');
  const {rows:[task]}=await client.query(`insert into content_remediation_tasks(workspace_id,finding_id,entity_type,entity_id,title,priority,created_by) values($1,$2,'entry',$3,'Assign owner','high',$4) returning id,status`,[workspaceId,reopened.id,entry.id,actor.adminUserId]);
  await client.query(`update content_remediation_tasks set status='done',completed_by=$2,completed_at=now() where id=$1`,[task.id,actor.adminUserId]);
  const {rows:[done]}=await client.query(`select status,completed_at from content_remediation_tasks where id=$1`,[task.id]);
  assert(done.status==='done' && done.completed_at,'Remediation completion state failed');
  console.log('[PASS] Remediation work can be tracked to completion.');

  console.log('\nPHASE 11 FOUNDATION CERTIFICATION: ALL PASSED');
} finally {
  try { if(workspaceId) await teardownCertification({client,workspaceId,authUserIds,adminUserIds}); } finally { await client.end(); }
}
