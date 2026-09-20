import { randomUUID } from "node:crypto";
import { createPgClient, createDisposableWorkspace, createAuthenticatedActor, teardownCertification } from "./cert-harness.mjs";

const client = await createPgClient();
const BASE_URL = process.env.CMS_CERT_BASE_URL || "http://localhost:3000";
let workspaceId = null;
const authUserIds = [];
const adminUserIds = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function fetchJson(path, init = {}) {
  const response = await fetch(`${BASE_URL}${path}`, init);
  let body = null; try { body = await response.json(); } catch {}
  return { response, body };
}

try {
  console.log("=== PHASE 11 AUTHENTICATED INTELLIGENCE API CERTIFICATION ===");
  const ws = await createDisposableWorkspace(client, "p11-http"); workspaceId = ws.id;
  const admin = await createAuthenticatedActor(client, workspaceId, {
    role: "admin", permissions: ["workspace.manage", "content.entry.read", "content.entry.edit", "media.read"], emailPrefix: "p11-http-admin",
  });
  const reader = await createAuthenticatedActor(client, workspaceId, {
    role: "viewer", permissions: ["content.entry.read"], emailPrefix: "p11-http-reader",
  });
  for (const actor of [admin, reader]) { authUserIds.push(actor.authUserId); adminUserIds.push(actor.adminUserId); }

  const { rows: [model] } = await client.query(`insert into content_models(workspace_id,name,api_key,status,current_schema_version,settings_json,created_by) values($1,'P11 HTTP Page',$2,'active',1,'{"capability":"publishable"}'::jsonb,$3) returning id`, [workspaceId, `p11_http_${Date.now()}_${randomUUID().slice(0,5)}`, admin.adminUserId]);
  const schema = { version: 1, fields: [{ key: "title", label: "Title", type: "text", required: true, unique: false, localized: false }], permissions: [] };
  await client.query(`insert into content_model_versions(content_model_id,version_number,schema_json,schema_hash,change_summary,created_by) values($1,1,$2::jsonb,$3,'P11 HTTP',$4)`, [model.id, JSON.stringify(schema), randomUUID(), admin.adminUserId]);
  const { rows: [entry] } = await client.query(`insert into content_entries(workspace_id,content_model_id,status,created_by,updated_by) values($1,$2,'draft',$3,$3) returning id`, [workspaceId, model.id, admin.adminUserId]);
  const { rows: [version] } = await client.query(`insert into content_entry_versions(entry_id,model_schema_version,version_number,data_jsonb,locale,state,created_by,change_summary) values($1,1,1,jsonb_build_object('title','Authenticated Intelligence Search'),'en','draft',$2,'P11 HTTP') returning id`, [entry.id, admin.adminUserId]);
  await client.query(`update content_entries set current_draft_version_id=$2 where id=$1`, [entry.id, version.id]);
  await client.query(`insert into content_search_documents(entry_id,workspace_id,version_id,content_model_id,locale,status,author_id,search_text) values($1,$2,$3,$4,'en','draft',$5,'Authenticated Intelligence Search') on conflict(entry_id) do update set version_id=excluded.version_id,search_text=excluded.search_text`, [entry.id, workspaceId, version.id, model.id, admin.adminUserId]);

  console.log("\n--- 1. Intelligence authorization boundaries ---");
  const noAuth = await fetchJson("/api/content-search?q=Authenticated");
  assert(noAuth.response.status === 401, `Expected search 401, got ${noAuth.response.status}`);
  const readerSearch = await fetchJson("/api/content-search?q=Authenticated", { headers: reader.headers });
  assert(readerSearch.response.status === 200 && readerSearch.body?.success, `Reader search failed: ${JSON.stringify(readerSearch.body)}`);
  const forbiddenHealth = await fetchJson("/api/intelligence/health", { method: "POST", headers: reader.headers, body: JSON.stringify({ operation: "update_profile", entryId: entry.id, ownerId: reader.adminUserId, reviewCadenceDays: 30 }) });
  assert(forbiddenHealth.response.status === 403, `Expected health mutation 403, got ${forbiddenHealth.response.status}`);
  const forbiddenAnalytics = await fetchJson("/api/intelligence/analytics", { method: "POST", headers: reader.headers, body: JSON.stringify({ operation: "ensure_ga4" }) });
  assert(forbiddenAnalytics.response.status === 403, `Expected analytics mutation 403, got ${forbiddenAnalytics.response.status}`);
  console.log("[PASS] Real 401/403/read boundaries certified.");

  console.log("\n--- 2. Ranked search + saved searches via HTTP ---");
  assert(readerSearch.body.data?.some?.((row) => row.entry_id === entry.id), "Ranked HTTP search did not expose the permission-visible fixture");
  const saved = await fetchJson("/api/content-search/saved", { method: "POST", headers: reader.headers, body: JSON.stringify({ name: "My Intelligence Search", query: { q: "Authenticated", status: "draft" } }) });
  assert(saved.response.status === 201 && saved.body?.success, `Saved search POST failed: ${JSON.stringify(saved.body)}`);
  const savedList = await fetchJson("/api/content-search/saved", { headers: reader.headers });
  assert(savedList.response.status === 200 && savedList.body?.data?.some?.((row) => row.name === "My Intelligence Search"), "Saved search not replayable/listed");
  console.log("[PASS] Ranked search and saved-search API certified.");

  console.log("\n--- 3. Content stewardship API + visibility ---");
  const profile = await fetchJson("/api/intelligence/health", { method: "POST", headers: admin.headers, body: JSON.stringify({ operation: "update_profile", entryId: entry.id, ownerId: admin.adminUserId, reviewCadenceDays: 30, lastReviewedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+90*86400000).toISOString() }) });
  assert(profile.response.status === 200 && profile.body?.success, `Profile update failed: ${JSON.stringify(profile.body)}`);
  const healthAdmin = await fetchJson("/api/intelligence/health", { headers: admin.headers });
  assert(healthAdmin.response.status === 200 && healthAdmin.body?.success, `Health GET failed: ${JSON.stringify(healthAdmin.body)}`);
  const steward = healthAdmin.body.data?.stewardship?.find?.((row) => row.entryId === entry.id);
  assert(steward?.profile?.owner_id === admin.adminUserId && healthAdmin.body.data?.members?.some?.((member) => member.id === admin.adminUserId), "Stewardship owner/member response incomplete");
  const healthReader = await fetchJson("/api/intelligence/health", { headers: reader.headers });
  assert(healthReader.response.status === 200 && healthReader.body?.data?.stewardship?.some?.((row) => row.entryId === entry.id), "Reader could not see permission-visible stewardship state");
  assert((healthReader.body?.data?.members ?? []).length === 0, "Read-only actor received assignable member directory");
  console.log("[PASS] Stewardship editing and least-privilege owner directory certified.");

  console.log("\n--- 4. Durable health + analytics synchronization APIs ---");
  const queuedHealth = await fetchJson("/api/intelligence/health", { method: "POST", headers: admin.headers, body: JSON.stringify({ operation: "queue_scan" }) });
  assert(queuedHealth.response.status === 202 && queuedHealth.body?.data?.kind === "health_scan", `Health queue failed: ${JSON.stringify(queuedHealth.body)}`);
  const ensure = await fetchJson("/api/intelligence/analytics", { method: "POST", headers: admin.headers, body: JSON.stringify({ operation: "ensure_ga4" }) });
  assert(ensure.response.status === 200 && ensure.body?.data?.id, `GA4 connector initialization failed: ${JSON.stringify(ensure.body)}`);
  const connectorId = ensure.body.data.id;
  const queuedAnalytics = await fetchJson("/api/intelligence/analytics", { method: "POST", headers: admin.headers, body: JSON.stringify({ operation: "queue_sync", connectorId }) });
  assert(queuedAnalytics.response.status === 202 && queuedAnalytics.body?.data?.kind === "analytics_sync", `Analytics durable queue failed: ${JSON.stringify(queuedAnalytics.body)}`);
  const overview = await fetchJson("/api/intelligence/analytics", { headers: admin.headers });
  assert(overview.response.status === 200 && overview.body?.data?.syncStates?.some?.((row) => row.connector_id === connectorId && row.status === "queued"), "Analytics freshness state does not expose queued durable synchronization");
  const { rows: jobs } = await client.query(`select kind,queue_name from delivery_jobs where workspace_id=$1 and id in ($2,$3)`, [workspaceId, queuedHealth.body.data.id, queuedAnalytics.body.data.id]);
  assert(jobs.some((j) => j.kind === "health_scan" && j.queue_name === "intelligence") && jobs.some((j) => j.kind === "analytics_sync" && j.queue_name === "intelligence"), "Durable Intelligence jobs were not stored on the Intelligence queue");
  console.log("[PASS] Health/analytics durable synchronization and explicit freshness state certified.");

  console.log("\n--- 5. Remediation queue via authenticated API ---");
  const { rows: [finding] } = await client.query(`select * from cms_upsert_health_finding($1,'entry',$2,'metadata_or_quality_warnings','warning',$3,'Fix metadata','Certification finding','{}'::jsonb)`, [workspaceId, entry.id, `p11-http-${randomUUID()}`]);
  const createTask = await fetchJson("/api/intelligence/health", { method: "POST", headers: admin.headers, body: JSON.stringify({ operation: "create_task", findingId: finding.id, entityType: "entry", entityId: entry.id, title: "Fix metadata", priority: "high", assignedTo: admin.adminUserId }) });
  assert(createTask.response.status === 201 && createTask.body?.data?.id, `Remediation create failed: ${JSON.stringify(createTask.body)}`);
  const doneTask = await fetchJson(`/api/intelligence/health/tasks/${createTask.body.data.id}`, { method: "PATCH", headers: admin.headers, body: JSON.stringify({ status: "done", resolutionNote: "Certified complete" }) });
  assert(doneTask.response.status === 200 && doneTask.body?.data?.status === "done", `Remediation completion failed: ${JSON.stringify(doneTask.body)}`);
  console.log("[PASS] Operational remediation queue certified through real HTTP.");

  console.log("\nPHASE 11 AUTHENTICATED INTELLIGENCE API CERTIFICATION: ALL PASSED");
} finally {
  if (workspaceId) {
    await client.query(`delete from content_entries where workspace_id=$1`, [workspaceId]).catch(() => {});
    await client.query(`delete from content_models where workspace_id=$1`, [workspaceId]).catch(() => {});
  }
  await teardownCertification({ client, workspaceId, authUserIds, adminUserIds });
  await client.end();
}
