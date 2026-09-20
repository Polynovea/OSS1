import {
  createPgClient,
  createDisposableWorkspace,
  createAuthenticatedActor,
  teardownCertification,
} from "./cert-harness.mjs";

const client = await createPgClient();
const BASE_URL = process.env.CMS_CERT_BASE_URL || "http://localhost:3000";
let workspaceId = null;
const authUserIds = [];
const adminUserIds = [];

const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function fetchJson(path, init = {}) {
  const response = await fetch(`${BASE_URL}${path}`, init);
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { response, body };
}

async function createModel(actorId) {
  const { rows } = await client.query(`
    insert into content_models (workspace_id,name,api_key,status,current_schema_version,settings_json,created_by)
    values ($1,'Phase 8 API Page',$2,'active',1,'{"capability":"publishable"}'::jsonb,$3)
    returning id
  `, [workspaceId, `p8_api_page_${Date.now()}`, actorId]);
  const modelId = rows[0].id;
  const schema = {
    version: 1,
    fields: [{ key: "title", label: "Title", type: "text", required: true, localized: true, unique: false }],
    permissions: [],
  };
  await client.query(`
    insert into content_model_versions(content_model_id,version_number,schema_json,schema_hash,change_summary,created_by)
    values($1,1,$2::jsonb,'p8-api-schema','Phase 8 API schema',$3)
  `, [modelId, JSON.stringify(schema), actorId]);
  return modelId;
}

async function createEntry(modelId, actorId, { locale = "en", status = "draft", title = "Entry" } = {}) {
  const { rows: entries } = await client.query(`
    insert into content_entries(workspace_id,content_model_id,status,created_by,updated_by)
    values($1,$2,$3,$4,$4) returning id
  `, [workspaceId, modelId, status, actorId]);
  const entryId = entries[0].id;
  const { rows: versions } = await client.query(`
    insert into content_entry_versions(entry_id,model_schema_version,version_number,data_jsonb,locale,state,created_by,change_summary)
    values($1,1,1,jsonb_build_object('title',$2::text),$3,$4,$5,'API certification') returning id
  `, [entryId, title, locale, status === "published" ? "published" : status === "approved" ? "approved" : "draft", actorId]);
  const versionId = versions[0].id;
  await client.query(`update content_entries set current_draft_version_id=$2::uuid, published_version_id=case when $3::text='published' then $2::uuid else null::uuid end where id=$1::uuid`, [entryId, versionId, status]);
  await client.query(`
    insert into content_search_documents(entry_id,workspace_id,version_id,content_model_id,locale,status,author_id,search_text)
    values($1,$2,$3,$4,$5,$6,$7,$8)
    on conflict(entry_id) do update set version_id=excluded.version_id,status=excluded.status,search_text=excluded.search_text
  `, [entryId, workspaceId, versionId, modelId, locale, status, actorId, title]);
  return { entryId, versionId };
}

try {
  console.log("=== PHASE 8 AUTHENTICATED APPLICATION API CERTIFICATION ===");
  const ws = await createDisposableWorkspace(client, "p8-http");
  workspaceId = ws.id;

  const authorized = await createAuthenticatedActor(client, workspaceId, {
    role: "admin",
    permissions: ["workspace.manage", "content.entry.read", "content.entry.create", "content.entry.edit", "content.entry.publish"],
    emailPrefix: "p8-http-admin",
  });
  const limited = await createAuthenticatedActor(client, workspaceId, {
    role: "viewer",
    permissions: ["content.entry.read"],
    emailPrefix: "p8-http-viewer",
  });
  for (const actor of [authorized, limited]) {
    authUserIds.push(actor.authUserId); adminUserIds.push(actor.adminUserId);
  }

  console.log("\n--- 1. Real HTTP authorization boundary ---");
  const noAuth = await fetchJson("/api/locales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: "en" }) });
  assert(noAuth.response.status === 401, `Expected 401 without token, got ${noAuth.response.status}`);
  const forbidden = await fetchJson("/api/locales", { method: "POST", headers: limited.headers, body: JSON.stringify({ locale: "en" }) });
  assert(forbidden.response.status === 403, `Expected 403 without workspace.manage, got ${forbidden.response.status}`);
  const releaseForbidden = await fetchJson("/api/releases", { method: "POST", headers: limited.headers, body: JSON.stringify({ name: "Forbidden", itemVersionIds: ["00000000-0000-0000-0000-000000000000"] }) });
  assert(releaseForbidden.response.status === 403, `Expected 403 without content.entry.publish, got ${releaseForbidden.response.status}`);
  console.log("[PASS] Real HTTP 401/403 enforcement certified for locale and release mutations.");

  console.log("\n--- 2. Locale configuration and workflow definition API ---");
  for (const payload of [
    { locale: "en", enabled: true, required: true, isDefault: true },
    { locale: "fr", enabled: true, required: true, isDefault: false, fallbackLocale: "en" },
  ]) {
    const result = await fetchJson("/api/locales", { method: "POST", headers: authorized.headers, body: JSON.stringify(payload) });
    assert(result.response.status === 200 && result.body?.success, `Locale API failed: ${JSON.stringify(result.body)}`);
  }
  const modelId = await createModel(authorized.adminUserId);
  const workflowCreate = await fetchJson("/api/workflows", {
    method: "POST", headers: authorized.headers,
    body: JSON.stringify({
      name: "Phase 8 API Workflow",
      contentModelId: modelId,
      active: true,
      selfApproval: true,
      stages: [{ key: "editorial", label: "Editorial approval", required_approvals: 1, required_role_keys: [] }],
    }),
  });
  assert(workflowCreate.response.status === 201 && workflowCreate.body?.success, `Workflow definition API failed: ${JSON.stringify(workflowCreate.body)}`);
  const workflows = await fetchJson("/api/workflows", { headers: authorized.headers });
  assert(workflows.response.status === 200 && workflows.body?.data?.definitions?.some?.((w) => w.name === "Phase 8 API Workflow"), "Workflow definition not returned by API");
  console.log("[PASS] Locale policy and configurable workflow definition APIs certified.");

  console.log("\n--- 3. Entry workflow and bulk workflow actions via HTTP ---");
  const single = await createEntry(modelId, authorized.adminUserId, { title: "Workflow single" });
  let wf = await fetchJson(`/api/entries/${single.entryId}/workflow`, { method: "POST", headers: authorized.headers, body: JSON.stringify({ action: "submit", comment: "API submit" }) });
  assert(wf.response.status === 200 && wf.body?.success, `Workflow submit failed: ${JSON.stringify(wf.body)}`);
  wf = await fetchJson(`/api/entries/${single.entryId}/workflow`, { method: "POST", headers: authorized.headers, body: JSON.stringify({ action: "approve", comment: "API approve" }) });
  assert(wf.response.status === 200 && wf.body?.success && wf.body?.data?.state === "approved", `Workflow approve failed: ${JSON.stringify(wf.body)}`);

  const bulkA = await createEntry(modelId, authorized.adminUserId, { title: "Bulk A" });
  const bulkB = await createEntry(modelId, authorized.adminUserId, { title: "Bulk B" });
  const bulkSubmit = await fetchJson("/api/entries/bulk/workflow", { method: "POST", headers: authorized.headers, body: JSON.stringify({ ids: [bulkA.entryId, bulkB.entryId], action: "submit", comment: "bulk submit" }) });
  assert(bulkSubmit.response.status === 200 && bulkSubmit.body?.data?.succeeded === 2, `Bulk submit failed: ${JSON.stringify(bulkSubmit.body)}`);
  const bulkApprove = await fetchJson("/api/entries/bulk/workflow", { method: "POST", headers: authorized.headers, body: JSON.stringify({ ids: [bulkA.entryId, bulkB.entryId], action: "approve", comment: "bulk approve" }) });
  assert(bulkApprove.response.status === 200 && bulkApprove.body?.data?.succeeded === 2, `Bulk approve failed: ${JSON.stringify(bulkApprove.body)}`);
  console.log("[PASS] Single-entry and bulk editorial workflow actions certified through real HTTP.");

  console.log("\n--- 4. Translation lifecycle and required-locale readiness ---");
  const source = await createEntry(modelId, authorized.adminUserId, { locale: "en", status: "approved", title: "English source" });
  const translation = await createEntry(modelId, authorized.adminUserId, { locale: "fr", status: "approved", title: "Traduction francaise" });

  const releaseCreate = await fetchJson("/api/releases", {
    method: "POST", headers: authorized.headers,
    body: JSON.stringify({ name: "Multilocale API Release", description: "Phase 8 exit criterion", itemVersionIds: [source.versionId], locales: ["en"] }),
  });
  assert(releaseCreate.response.status === 201 && releaseCreate.body?.success, `Release create failed: ${JSON.stringify(releaseCreate.body)}`);
  const releaseId = releaseCreate.body.data.id;

  let readiness = await fetchJson(`/api/releases/${releaseId}/readiness`, { headers: authorized.headers });
  assert(readiness.response.status === 200 && readiness.body?.data?.status === "blocked", `Missing required fr locale did not block readiness: ${JSON.stringify(readiness.body)}`);
  assert(readiness.body.data.issues.some((issue) => issue.code === "localization.required_locale" && issue.locale === "fr"), "Readiness did not explain required fr blocker");
  const blockedApprove = await fetchJson(`/api/releases/${releaseId}/transition`, { method: "POST", headers: authorized.headers, body: JSON.stringify({ action: "approve", comment: "should block" }) });
  assert(blockedApprove.response.status === 409, `Blocked release approval should be 409, got ${blockedApprove.response.status}`);
  assert((await client.query(`select status from releases where id=$1`, [releaseId])).rows[0].status === "draft", "Blocked service approval mutated release state");

  const link = await fetchJson(`/api/entries/${source.entryId}/localization`, {
    method: "PUT", headers: authorized.headers,
    body: JSON.stringify({ locale: "fr", translatedEntryId: translation.entryId, markReviewed: false }),
  });
  assert(link.response.status === 200 && link.body?.success, `Translation link failed: ${JSON.stringify(link.body)}`);
  const locBeforeReview = await fetchJson(`/api/entries/${source.entryId}/localization`, { headers: authorized.headers });
  const frBefore = locBeforeReview.body?.data?.find?.((row) => row.locale === "fr");
  assert(frBefore?.status === "needs_review", `Expected needs_review translation state, got ${frBefore?.status}`);

  const replaceItems = await fetchJson(`/api/releases/${releaseId}`, {
    method: "PATCH", headers: authorized.headers,
    body: JSON.stringify({ operation: "replace_items", itemVersionIds: [source.versionId, translation.versionId] }),
  });
  assert(replaceItems.response.status === 200 && replaceItems.body?.success, `Release item replacement failed: ${JSON.stringify(replaceItems.body)}`);
  readiness = await fetchJson(`/api/releases/${releaseId}/readiness`, { headers: authorized.headers });
  assert(readiness.body?.data?.status === "blocked", "Unreviewed translation should still block required-locale readiness");

  const review = await fetchJson(`/api/entries/${source.entryId}/localization`, { method: "PUT", headers: authorized.headers, body: JSON.stringify({ locale: "fr", action: "review" }) });
  assert(review.response.status === 200 && review.body?.success, `Translation review failed: ${JSON.stringify(review.body)}`);
  const locAfterReview = await fetchJson(`/api/entries/${source.entryId}/localization`, { headers: authorized.headers });
  assert(locAfterReview.body?.data?.find?.((row) => row.locale === "fr")?.status === "current", "Reviewed approved translation did not become current");
  // The coordinated release is only publish-ready once each included locale
  // also has a canonical destination. Create those managed destinations here
  // so this certificate tests localization rather than bypassing route policy.
  await client.query(`
    insert into content_routes(workspace_id,entry_id,locale,path,title,is_canonical,status)
    values($1,$2,'en','/phase8-source','Phase 8 source',true,'active'),
          ($1,$3,'fr','/phase8-traduction','Phase 8 traduction',true,'active')
  `, [workspaceId, source.entryId, translation.entryId]);
  readiness = await fetchJson(`/api/releases/${releaseId}/readiness`, { headers: authorized.headers });
  assert(readiness.response.status === 200 && readiness.body?.data?.status === "ready", `Coordinated locale release did not become ready: ${JSON.stringify(readiness.body)}`);
  console.log("[PASS] Required locale blocker, needs-review lifecycle, review action, and coordinated locale readiness certified.");

  console.log("\n--- 5. Release approval, drift protection, exact publication via HTTP ---");
  const approve = await fetchJson(`/api/releases/${releaseId}/transition`, { method: "POST", headers: authorized.headers, body: JSON.stringify({ action: "approve", comment: "Locales ready" }) });
  assert(approve.response.status === 200 && approve.body?.success, `Release approval failed: ${JSON.stringify(approve.body)}`);
  const rollbackCount = Number((await client.query(`select count(*)::int c from release_rollback_items where release_id=$1`, [releaseId])).rows[0].c);
  assert(rollbackCount === 2, "HTTP release approval did not capture rollback plan for every item");

  const { rows: driftRows } = await client.query(`
    insert into content_entry_versions(entry_id,model_schema_version,version_number,data_jsonb,locale,state,created_by,change_summary)
    values($1,1,2,'{"title":"Drift"}'::jsonb,'en','approved',$2,'Post-approval drift') returning id
  `, [source.entryId, authorized.adminUserId]);
  await client.query(`update content_entries set current_draft_version_id=$2,status='approved' where id=$1`, [source.entryId, driftRows[0].id]);
  const driftPublish = await fetchJson(`/api/releases/${releaseId}/publish`, { method: "POST", headers: authorized.headers, body: "{}" });
  assert(driftPublish.response.status === 409, `Drifted HTTP publish should be 409, got ${driftPublish.response.status}`);
  assert((await client.query(`select status from releases where id=$1`, [releaseId])).rows[0].status === "approved", "Drift-blocked HTTP publish mutated release status");
  await client.query(`update content_entries set current_draft_version_id=$2,status='approved' where id=$1`, [source.entryId, source.versionId]);

  const publish = await fetchJson(`/api/releases/${releaseId}/publish`, { method: "POST", headers: authorized.headers, body: "{}" });
  assert(publish.response.status === 200 && publish.body?.success && publish.body?.data?.status === "published", `HTTP release publish failed: ${JSON.stringify(publish.body)}`);
  const published = (await client.query(`select id,published_version_id,status from content_entries where id=any($1::uuid[])`, [[source.entryId, translation.entryId]])).rows;
  assert(published.find((row) => row.id === source.entryId)?.published_version_id === source.versionId, "Source did not publish pinned version");
  assert(published.find((row) => row.id === translation.entryId)?.published_version_id === translation.versionId, "Translation did not publish pinned version");
  console.log("[PASS] HTTP approval, rollback snapshot, drift blocking, and exact pinned-version multilocale publication certified.");

  console.log("\n--- 6. Release scheduling through HTTP ---");
  const scheduledEntry = await createEntry(modelId, authorized.adminUserId, { locale: "en", status: "approved", title: "Scheduled API entry" });
  await client.query(`
    insert into content_routes(workspace_id,entry_id,locale,path,title,is_canonical,status)
    values($1,$2,'en','/phase8-scheduled','Scheduled API entry',true,'active')
  `, [workspaceId, scheduledEntry.entryId]);
  const scheduleReleaseCreate = await fetchJson("/api/releases", { method: "POST", headers: authorized.headers, body: JSON.stringify({ name: "Scheduled API release", itemVersionIds: [scheduledEntry.versionId], locales: ["en", "fr"] }) });
  const scheduledReleaseId = scheduleReleaseCreate.body?.data?.id;
  assert(scheduleReleaseCreate.response.status === 201 && scheduledReleaseId, `Scheduled release create failed: ${JSON.stringify(scheduleReleaseCreate.body)}`);
  // fr is required but this release has no translation, so remove requirement for this isolated scheduling check only.
  await fetchJson("/api/locales", { method: "POST", headers: authorized.headers, body: JSON.stringify({ locale: "fr", enabled: true, required: false, isDefault: false, fallbackLocale: "en" }) });
  const setLocales = await fetchJson(`/api/releases/${scheduledReleaseId}`, { method: "PATCH", headers: authorized.headers, body: JSON.stringify({ operation: "set_locales", locales: ["en"] }) });
  assert(setLocales.response.status === 200, "Could not narrow optional locale targets for scheduling certification");
  const scheduledApprove = await fetchJson(`/api/releases/${scheduledReleaseId}/transition`, { method: "POST", headers: authorized.headers, body: JSON.stringify({ action: "approve" }) });
  assert(scheduledApprove.response.status === 200, `Scheduled release approval failed: ${JSON.stringify(scheduledApprove.body)}`);
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const schedule = await fetchJson(`/api/releases/${scheduledReleaseId}/transition`, { method: "POST", headers: authorized.headers, body: JSON.stringify({ action: "schedule", scheduledFor: future, comment: "Calendar certification" }) });
  assert(schedule.response.status === 200 && schedule.body?.data?.status === "scheduled", `HTTP scheduling failed: ${JSON.stringify(schedule.body)}`);
  const calendar = (await client.query(`select status from editorial_calendar_events where release_id=$1 and kind='release' order by created_at desc limit 1`, [scheduledReleaseId])).rows[0];
  assert(calendar?.status === "scheduled", "HTTP scheduling did not create scheduled calendar event");
  console.log("[PASS] Approved release can be scheduled and appears in the editorial calendar through the application boundary.");

  console.log("\nPHASE 8 AUTHENTICATED APPLICATION API CERTIFICATION: ALL PASSED");
} finally {
  try {
    await teardownCertification({ client, workspaceId, authUserIds, adminUserIds });
  } finally {
    await client.end();
  }
}
