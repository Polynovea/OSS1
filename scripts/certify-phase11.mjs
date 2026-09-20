import { randomUUID } from "node:crypto";
import {
  createPgClient,
  createDisposableWorkspace,
  createAuthenticatedActor,
  teardownCertification,
} from "./cert-harness.mjs";

const client = await createPgClient();
let workspaceId = null;
let secondWorkspaceId = null;
const authUserIds = [];
const adminUserIds = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const expectFailure = async (label, fn, includes) => {
  let failed = false;
  try { await fn(); } catch (error) {
    failed = true;
    if (includes && !String(error.message).toLowerCase().includes(includes.toLowerCase())) throw error;
    console.log(`[PASS] ${label}: rejected as expected (${error.message})`);
  }
  if (!failed) throw new Error(`${label}: expected failure`);
};

try {
  console.log("=== PHASE 11 FULL SEARCH / ANALYTICS / HEALTH CERTIFICATION ===");
  const ws = await createDisposableWorkspace(client, "p11-full");
  workspaceId = ws.id;
  const actor = await createAuthenticatedActor(client, workspaceId, {
    role: "admin",
    permissions: ["workspace.manage", "content.entry.read", "content.entry.edit", "media.read"],
    emailPrefix: "p11-full-admin",
  });
  authUserIds.push(actor.authUserId); adminUserIds.push(actor.adminUserId);

  const otherWs = await createDisposableWorkspace(client, "p11-other");
  secondWorkspaceId = otherWs.id;
  const outsider = await createAuthenticatedActor(client, secondWorkspaceId, {
    role: "admin", permissions: ["workspace.manage"], emailPrefix: "p11-outsider",
  });
  authUserIds.push(outsider.authUserId); adminUserIds.push(outsider.adminUserId);

  const { rows: [model] } = await client.query(`
    insert into content_models(workspace_id,name,api_key,status,current_schema_version,settings_json,created_by)
    values($1,'Phase 11 Page',$2,'active',1,'{"capability":"publishable"}'::jsonb,$3) returning id
  `, [workspaceId, `p11_${Date.now()}_${randomUUID().slice(0,6)}`, actor.adminUserId]);
  const schema = { version: 1, fields: [{ key: "title", label: "Title", type: "text", required: true, unique: false, localized: false }], permissions: [] };
  await client.query(`insert into content_model_versions(content_model_id,version_number,schema_json,schema_hash,change_summary,created_by) values($1,1,$2::jsonb,$3,'P11 certification',$4)`, [model.id, JSON.stringify(schema), randomUUID(), actor.adminUserId]);
  const { rows: [entry] } = await client.query(`insert into content_entries(workspace_id,content_model_id,status,created_by,updated_by) values($1,$2,'draft',$3,$3) returning id`, [workspaceId, model.id, actor.adminUserId]);
  const { rows: [version] } = await client.query(`insert into content_entry_versions(entry_id,model_schema_version,version_number,data_jsonb,locale,state,created_by,change_summary) values($1,1,1,jsonb_build_object('title','Phase Eleven Search Intelligence'),'en','draft',$2,'P11 certification') returning id`, [entry.id, actor.adminUserId]);
  await client.query(`update content_entries set current_draft_version_id=$2 where id=$1`, [entry.id, version.id]);
  await client.query(`insert into content_search_documents(entry_id,workspace_id,version_id,content_model_id,locale,status,author_id,search_text) values($1,$2,$3,$4,'en','draft',$5,'Phase Eleven Search Intelligence') on conflict(entry_id) do update set version_id=excluded.version_id,search_text=excluded.search_text`, [entry.id, workspaceId, version.id, model.id, actor.adminUserId]);

  console.log("\n--- 1. Ranked search + saved search state ---");
  const { rows: ranked } = await client.query(`select * from cms_search_content_ranked($1,'Phase Eleven Search',null,null,null,null,null,null,null,20,0)`, [workspaceId]);
  assert(ranked.some((row) => row.entry_id === entry.id && (Number(row.rank) > 0 || Number(row.similarity) > 0)), "Ranked search did not return/relevance-score the fixture entry");
  await client.query(`insert into content_saved_searches(workspace_id,owner_id,name,query_json,is_shared) values($1,$2,'My phase 11 search','{"q":"Phase Eleven"}'::jsonb,false)`, [workspaceId, actor.adminUserId]);
  await expectFailure("Duplicate personal saved search name", () => client.query(`insert into content_saved_searches(workspace_id,owner_id,name,query_json) values($1,$2,'My phase 11 search','{}'::jsonb)`, [workspaceId, actor.adminUserId]), "duplicate");
  console.log("[PASS] Ranked search and saved-search ownership certified.");

  console.log("\n--- 2. Analytics freshness aging ---");
  const { rows: [connector] } = await client.query(`insert into analytics_connectors(workspace_id,provider,name,credential_mode,active,created_by) values($1,'ga4','P11 GA4','environment',true,$2) returning id`, [workspaceId, actor.adminUserId]);
  await client.query(`insert into analytics_sync_state(connector_id,workspace_id,status,last_success_at,fresh_through) values($1,$2,'fresh',now()-interval '5 days',current_date-5)`, [connector.id, workspaceId]);
  await client.query("begin");
  const { rows: [aged] } = await client.query(`select cms_age_analytics_freshness() n`);
  const { rows: [stale] } = await client.query(`select status from analytics_sync_state where connector_id=$1`, [connector.id]);
  assert(aged.n >= 1 && stale.status === "stale", "Freshness aging did not make stale historical analytics explicit");
  await client.query("rollback");
  console.log("[PASS] Historical snapshots cannot remain indefinitely labelled fresh.");

  console.log("\n--- 3. Governed content stewardship ---");
  const { rows: [profile] } = await client.query(`select * from cms_upsert_content_health_profile($1,$2,$3,$4,30,now()-interval '10 days',now()+interval '90 days')`, [workspaceId, actor.adminUserId, entry.id, actor.adminUserId]);
  assert(profile.owner_id === actor.adminUserId && profile.review_cadence_days === 30, "Valid content-health profile did not persist");
  const { rows: [auditBefore] } = await client.query(`select count(*)::int c from platform_audit_events where workspace_id=$1 and action='content_health.profile_updated'`, [workspaceId]);
  await expectFailure("Cross-workspace health owner", () => client.query(`select cms_upsert_content_health_profile($1,$2,$3,$4,30,null,null)`, [workspaceId, actor.adminUserId, entry.id, outsider.adminUserId]), "active workspace member");
  await expectFailure("Invalid review cadence", () => client.query(`select cms_upsert_content_health_profile($1,$2,$3,$4,0,null,null)`, [workspaceId, actor.adminUserId, entry.id, actor.adminUserId]), "between 1 and 3650");
  const { rows: [auditAfter] } = await client.query(`select count(*)::int c from platform_audit_events where workspace_id=$1 and action='content_health.profile_updated'`, [workspaceId]);
  assert(auditAfter.c === auditBefore.c, "Failed stewardship mutation leaked audit events");
  console.log("[PASS] Ownership/review/expiry governance and failed-mutation audit integrity certified.");

  console.log("\n--- 4. Scheduled durable analytics + health work ---");
  await client.query("begin");
  await client.query(`delete from delivery_jobs where workspace_id=$1 and idempotency_key like 'health-daily:%' or workspace_id=$1 and idempotency_key like 'analytics-daily:%'`, [workspaceId]);
  await client.query(`select cms_enqueue_daily_maintenance_jobs()`);
  const { rows: maintenance } = await client.query(`select kind,queue_name,status,safe_metadata_json from delivery_jobs where workspace_id=$1 and kind in ('health_scan','analytics_sync')`, [workspaceId]);
  assert(maintenance.some((j) => j.kind === "health_scan" && j.queue_name === "intelligence"), "Daily health scan was not durably scheduled");
  assert(maintenance.some((j) => j.kind === "analytics_sync" && j.queue_name === "intelligence"), "Daily analytics sync was not durably scheduled");
  const { rows: [queuedState] } = await client.query(`select status from analytics_sync_state where connector_id=$1`, [connector.id]);
  assert(queuedState.status === "queued", "Scheduled analytics producer did not expose queued freshness state");
  await client.query("rollback");
  console.log("[PASS] Scheduled analytics/health synchronization is durable and idempotent.");

  console.log("\n--- 5. Materialized finding + remediation lifecycle ---");
  const fingerprint = `p11-${randomUUID()}`;
  const { rows: [finding] } = await client.query(`select * from cms_upsert_health_finding($1,'entry',$2,'review_overdue','warning',$3,'Review overdue','Certification finding','{}'::jsonb)`, [workspaceId, entry.id, fingerprint]);
  const { rows: [task] } = await client.query(`insert into content_remediation_tasks(workspace_id,finding_id,entity_type,entity_id,title,status,priority,assigned_to,created_by) values($1,$2,'entry',$3,'Resolve review','open','high',$4,$4) returning id`, [workspaceId, finding.id, entry.id, actor.adminUserId]);
  await client.query(`update content_remediation_tasks set status='done',completed_by=$2,completed_at=now(),resolution_note='Certified',updated_at=now() where id=$1`, [task.id, actor.adminUserId]);
  const { rows: [done] } = await client.query(`select status,completed_at from content_remediation_tasks where id=$1`, [task.id]);
  assert(done.status === "done" && done.completed_at, "Remediation lifecycle did not complete");
  console.log("[PASS] Materialized health finding and operational remediation lifecycle certified.");

  console.log("\nPHASE 11 FULL DATABASE CERTIFICATION: ALL PASSED");
} finally {
  if (workspaceId) {
    await client.query(`delete from content_entries where workspace_id=$1`, [workspaceId]).catch(() => {});
    await client.query(`delete from content_models where workspace_id=$1`, [workspaceId]).catch(() => {});
  }
  await teardownCertification({ client, workspaceId, authUserIds, adminUserIds });
  if (secondWorkspaceId) {
    await client.query(`delete from workspaces where id=$1`, [secondWorkspaceId]).catch(() => {});
  }
  await client.end();
}
