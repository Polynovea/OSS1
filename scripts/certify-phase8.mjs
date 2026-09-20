import {
  createPgClient,
  createDisposableWorkspace,
  createAuthenticatedActor,
  teardownCertification,
} from "./cert-harness.mjs";

const client = await createPgClient();
let workspaceId = null;
const authUserIds = [];
const adminUserIds = [];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function expectPgFailure(label, fn, contains) {
  try {
    await fn();
  } catch (error) {
    const message = String(error?.message || error);
    if (contains && !message.includes(contains)) {
      throw new Error(`${label}: failed for unexpected reason: ${message}`);
    }
    console.log(`[PASS] ${label}: rejected as expected (${message})`);
    return;
  }
  throw new Error(`${label}: expected failure, but operation succeeded`);
}

async function createModel(actorId) {
  const { rows } = await client.query(`
    insert into content_models (workspace_id, name, api_key, status, current_schema_version, settings_json, created_by)
    values ($1, 'Phase 8 Certification Page', $2, 'active', 1, '{"capability":"publishable"}'::jsonb, $3)
    returning id
  `, [workspaceId, `p8_page_${Date.now()}`, actorId]);
  const modelId = rows[0].id;
  const schema = {
    version: 1,
    fields: [
      { key: "title", label: "Title", type: "text", required: true, localized: false, unique: false },
    ],
    permissions: [],
  };
  await client.query(`
    insert into content_model_versions (content_model_id, version_number, schema_json, schema_hash, change_summary, created_by)
    values ($1, 1, $2::jsonb, 'phase8-cert-schema', 'Phase 8 certification schema', $3)
  `, [modelId, JSON.stringify(schema), actorId]);
  return modelId;
}

async function createDraftEntry(modelId, actorId, title) {
  const { rows: entryRows } = await client.query(`
    insert into content_entries (workspace_id, content_model_id, status, created_by, updated_by)
    values ($1, $2, 'draft', $3, $3)
    returning id
  `, [workspaceId, modelId, actorId]);
  const entryId = entryRows[0].id;
  const { rows: versionRows } = await client.query(`
    insert into content_entry_versions (entry_id, model_schema_version, version_number, data_jsonb, locale, state, created_by, change_summary)
    values ($1, 1, 1, jsonb_build_object('title',$2::text), 'en', 'draft', $3, 'Certification draft')
    returning id
  `, [entryId, title, actorId]);
  const versionId = versionRows[0].id;
  await client.query(`update content_entries set current_draft_version_id=$2 where id=$1`, [entryId, versionId]);
  return { entryId, versionId };
}

async function createReleaseEntry(modelId, actorId, title, withPriorPublished = true) {
  const { rows: entryRows } = await client.query(`
    insert into content_entries (workspace_id, content_model_id, status, created_by, updated_by)
    values ($1, $2, 'approved', $3, $3)
    returning id
  `, [workspaceId, modelId, actorId]);
  const entryId = entryRows[0].id;
  let priorVersionId = null;
  let nextVersionNumber = 1;
  if (withPriorPublished) {
    const { rows } = await client.query(`
      insert into content_entry_versions (entry_id, model_schema_version, version_number, data_jsonb, locale, state, created_by, change_summary)
      values ($1, 1, 1, jsonb_build_object('title',$2::text), 'en', 'published', $3, 'Previous published version')
      returning id
    `, [entryId, `${title} old`, actorId]);
    priorVersionId = rows[0].id;
    nextVersionNumber = 2;
  }
  const { rows: targetRows } = await client.query(`
    insert into content_entry_versions (entry_id, model_schema_version, version_number, data_jsonb, locale, state, created_by, change_summary)
    values ($1, 1, $2, jsonb_build_object('title',$3::text), 'en', 'approved', $4, 'Pinned approved version')
    returning id
  `, [entryId, nextVersionNumber, title, actorId]);
  const targetVersionId = targetRows[0].id;
  await client.query(`
    update content_entries
    set status='approved', current_draft_version_id=$2, published_version_id=$3
    where id=$1
  `, [entryId, targetVersionId, priorVersionId]);
  await client.query(`
    insert into content_search_documents (entry_id, workspace_id, version_id, content_model_id, locale, status, author_id, search_text)
    values ($1,$2,$3,$4,'en','approved',$5,$6)
    on conflict (entry_id) do update set version_id=excluded.version_id,status=excluded.status,search_text=excluded.search_text
  `, [entryId, workspaceId, targetVersionId, modelId, actorId, title]);
  return { entryId, priorVersionId, targetVersionId };
}

try {
  console.log("=== PHASE 8 LIVE DATABASE CERTIFICATION ===");
  const ws = await createDisposableWorkspace(client, "p8-live");
  workspaceId = ws.id;
  console.log(`[SETUP] Disposable workspace ${workspaceId}`);

  const requester = await createAuthenticatedActor(client, workspaceId, { role: "editor", emailPrefix: "p8-requester" });
  const reviewer = await createAuthenticatedActor(client, workspaceId, { role: "admin", emailPrefix: "p8-reviewer" });
  const legal = await createAuthenticatedActor(client, workspaceId, { role: "admin", emailPrefix: "p8-legal" });
  for (const actor of [requester, reviewer, legal]) {
    authUserIds.push(actor.authUserId);
    adminUserIds.push(actor.adminUserId);
  }

  console.log("\n--- 1. RPC privilege boundary ---");
  const rpcNames = [
    "cms_configure_locale", "cms_upsert_workflow_definition", "cms_transition_workflow",
    "cms_create_release", "cms_replace_release_items", "cms_set_release_locales",
    "cms_transition_release", "cms_publish_release", "cms_assign_release",
  ];
  const { rows: aclRows } = await client.query(`select proname, proacl from pg_proc where proname = any($1::text[])`, [rpcNames]);
  assert(aclRows.length === rpcNames.length, `Expected ${rpcNames.length} Phase 8 RPCs, found ${aclRows.length}`);
  for (const row of aclRows) {
    const entries = String(row.proacl || "").replace(/^\{|\}$/g, "").split(",").filter(Boolean);
    assert(!entries.some((entry) => entry.startsWith("=")), `${row.proname} grants PUBLIC execute`);
    assert(!entries.some((entry) => entry.startsWith("anon=")), `${row.proname} grants anon execute`);
    assert(!entries.some((entry) => entry.startsWith("authenticated=")), `${row.proname} grants authenticated execute`);
    assert(entries.some((entry) => entry.startsWith("service_role=X/")), `${row.proname} is not executable by service_role`);
  }
  console.log("[PASS] All Phase 8 RPCs are service-bound; PUBLIC/anon/authenticated execute denied.");

  console.log("\n--- 2. Locale policy and fallback cycles ---");
  await client.query(`select cms_configure_locale($1,$2,'en',true,true,true,null)`, [workspaceId, requester.adminUserId]);
  await client.query(`select cms_configure_locale($1,$2,'fr',true,true,false,'en')`, [workspaceId, requester.adminUserId]);
  await client.query(`select cms_configure_locale($1,$2,'de',true,false,false,'fr')`, [workspaceId, requester.adminUserId]);
  const { rows: localeRows } = await client.query(`select locale,required,is_default,fallback_locale from workspace_locales where workspace_id=$1 order by locale`, [workspaceId]);
  assert(localeRows.length === 3, "Expected en/fr/de locale policy rows");
  const beforeLocaleAudit = Number((await client.query(`select count(*)::int c from platform_audit_events where workspace_id=$1`, [workspaceId])).rows[0].c);
  await expectPgFailure("Fallback cycle en -> de -> fr -> en", () => client.query(`select cms_configure_locale($1,$2,'en',true,true,true,'de')`, [workspaceId, requester.adminUserId]), "cycle");
  const afterLocaleAudit = Number((await client.query(`select count(*)::int c from platform_audit_events where workspace_id=$1`, [workspaceId])).rows[0].c);
  const enFallback = (await client.query(`select fallback_locale from workspace_locales where workspace_id=$1 and locale='en'`, [workspaceId])).rows[0].fallback_locale;
  assert(enFallback === null, "Failed fallback-cycle mutation changed the default locale row");
  assert(afterLocaleAudit === beforeLocaleAudit, "Failed locale mutation leaked an audit event");
  console.log("[PASS] Required/default/fallback locale policy persisted; fallback cycle rejected atomically with 0 audit leak.");

  console.log("\n--- 3. Configurable multi-stage workflow ---");
  const modelId = await createModel(requester.adminUserId);
  const { rows: roleRows } = await client.query(`
    insert into roles (workspace_id,key,name,is_system)
    values ($1,'p8_reviewer','Phase 8 Reviewer',false),($1,'p8_legal','Phase 8 Legal',false)
    returning id,key
  `, [workspaceId]);
  const reviewerRoleId = roleRows.find(r => r.key === "p8_reviewer").id;
  const legalRoleId = roleRows.find(r => r.key === "p8_legal").id;
  const reviewerMember = (await client.query(`select id from workspace_members where workspace_id=$1 and admin_user_id=$2`, [workspaceId, reviewer.adminUserId])).rows[0].id;
  const legalMember = (await client.query(`select id from workspace_members where workspace_id=$1 and admin_user_id=$2`, [workspaceId, legal.adminUserId])).rows[0].id;
  await client.query(`insert into member_roles(workspace_member_id,role_id) values ($1,$2),($3,$4)`, [reviewerMember, reviewerRoleId, legalMember, legalRoleId]);

  const workflowDefinition = {
    self_approval: false,
    approval_stages: [
      { key: "editorial", label: "Editorial", required_approvals: 1, required_role_keys: ["p8_reviewer"] },
      { key: "legal", label: "Legal", required_approvals: 1, required_role_keys: ["p8_legal"] },
    ],
  };
  await client.query(`select cms_upsert_workflow_definition($1,$2,null,'Phase 8 staged workflow',$3,$4::jsonb,true)`, [workspaceId, requester.adminUserId, modelId, JSON.stringify(workflowDefinition)]);
  const wfEntry = await createDraftEntry(modelId, requester.adminUserId, "Workflow entry");
  const submit = (await client.query(`select cms_transition_workflow($1,$2,$3,'submit','Ready for review',false) as result`, [workspaceId, requester.adminUserId, wfEntry.entryId])).rows[0].result;
  const workflowInstanceId = submit.instance_id;
  assert(submit.state === "in_review" && submit.stage === 0, "Workflow did not enter stage 0 review");

  const wfAuditBefore = Number((await client.query(`select count(*)::int c from platform_audit_events where workspace_id=$1 and entity_id=$2`, [workspaceId, wfEntry.entryId])).rows[0].c);
  await expectPgFailure("Self approval", () => client.query(`select cms_transition_workflow($1,$2,$3,'approve','self',true)`, [workspaceId, requester.adminUserId, wfEntry.entryId]), "cannot approve");
  const wfAuditAfter = Number((await client.query(`select count(*)::int c from platform_audit_events where workspace_id=$1 and entity_id=$2`, [workspaceId, wfEntry.entryId])).rows[0].c);
  assert(wfAuditAfter === wfAuditBefore, "Rejected self approval leaked an audit event");
  assert(Number((await client.query(`select count(*)::int c from workflow_stage_approvals where workflow_instance_id=$1`, [workflowInstanceId])).rows[0].c) === 0, "Rejected self approval wrote stage evidence");

  await expectPgFailure("Wrong role on editorial stage", () => client.query(`select cms_transition_workflow($1,$2,$3,'approve','legal too early',true)`, [workspaceId, legal.adminUserId, wfEntry.entryId]), "different workspace role");
  const stage1 = (await client.query(`select cms_transition_workflow($1,$2,$3,'approve','editorial approved',true) as result`, [workspaceId, reviewer.adminUserId, wfEntry.entryId])).rows[0].result;
  assert(stage1.state === "in_review" && stage1.stage === 1, "Editorial approval did not advance to legal stage");
  const finalApproval = (await client.query(`select cms_transition_workflow($1,$2,$3,'approve','legal approved',true) as result`, [workspaceId, legal.adminUserId, wfEntry.entryId])).rows[0].result;
  assert(finalApproval.state === "approved", "Final stage did not approve workflow");
  const wfState = (await client.query(`select ce.status,wi.current_state,wi.current_stage,wi.completed_at from content_entries ce join workflow_instances wi on wi.entry_id=ce.id where ce.id=$1 order by wi.started_at desc limit 1`, [wfEntry.entryId])).rows[0];
  assert(wfState.status === "approved" && wfState.current_state === "approved" && wfState.completed_at, "Approved workflow did not atomically advance entry state");
  assert(Number((await client.query(`select count(*)::int c from workflow_stage_approvals where workflow_instance_id=$1`, [workflowInstanceId])).rows[0].c) === 2, "Expected exactly two stage approval evidence rows");
  console.log("[PASS] Model-specific 2-stage role-gated workflow, self-approval denial, stage evidence, and final approval certified.");

  console.log("\n--- 4. Release required locales and rollback snapshot ---");
  const a = await createReleaseEntry(modelId, requester.adminUserId, "Release A");
  const b = await createReleaseEntry(modelId, requester.adminUserId, "Release B");
  const release = (await client.query(`select cms_create_release($1,$2,'Phase 8 atomic release','cert', $3::jsonb, '["en"]'::jsonb) as result`, [workspaceId, requester.adminUserId, JSON.stringify([a.targetVersionId, b.targetVersionId])])).rows[0].result;
  const releaseId = release.id;
  const targetLocales = (await client.query(`select locale,required from release_locale_targets where release_id=$1 order by locale`, [releaseId])).rows;
  assert(targetLocales.some(r => r.locale === "fr" && r.required === true), "Required locale fr was omitted from release creation");
  assert(targetLocales.some(r => r.locale === "en" && r.required === true), "Required default locale en was omitted from release creation");

  await client.query(`select cms_transition_release($1,$2,$3,'approve',null,'Approved for atomic certification')`, [workspaceId, reviewer.adminUserId, releaseId]);
  const rollbackRows = (await client.query(`select entry_id,target_version_id,previous_published_version_id from release_rollback_items where release_id=$1 order by entry_id`, [releaseId])).rows;
  assert(rollbackRows.length === 2, "Approval did not create rollback snapshot for every release item");
  const rollbackByEntry = new Map(rollbackRows.map(r => [r.entry_id, r]));
  assert(rollbackByEntry.get(a.entryId)?.previous_published_version_id === a.priorVersionId, "Release A rollback snapshot is wrong");
  assert(rollbackByEntry.get(b.entryId)?.previous_published_version_id === b.priorVersionId, "Release B rollback snapshot is wrong");
  console.log("[PASS] Required locales cannot be omitted and approval captured exact prior-published rollback targets.");

  console.log("\n--- 5. Mid-release failure rolls back every partial write ---");
  const { rows: driftRows } = await client.query(`
    insert into content_entry_versions (entry_id, model_schema_version, version_number, data_jsonb, locale, state, created_by, change_summary)
    values ($1,1,3,'{"title":"Release B drift"}'::jsonb,'en','approved',$2,'Drift after release approval')
    returning id
  `, [b.entryId, requester.adminUserId]);
  const driftVersionId = driftRows[0].id;
  await client.query(`update content_entries set current_draft_version_id=$2,status='approved' where id=$1`, [b.entryId, driftVersionId]);
  const auditBeforeFailedPublish = Number((await client.query(`select count(*)::int c from platform_audit_events where workspace_id=$1`, [workspaceId])).rows[0].c);
  const historyBeforeFailedPublish = Number((await client.query(`select count(*)::int c from release_history where release_id=$1`, [releaseId])).rows[0].c);
  await expectPgFailure("Pinned release publish after item drift", () => client.query(`select cms_publish_release($1,$2,$3)`, [workspaceId, reviewer.adminUserId, releaseId]), "drifted after approval");
  const releaseAfterFailure = (await client.query(`select status from releases where id=$1`, [releaseId])).rows[0].status;
  const entriesAfterFailure = (await client.query(`select id,status,published_version_id,current_draft_version_id from content_entries where id=any($1::uuid[]) order by id`, [[a.entryId,b.entryId]])).rows;
  const aAfter = entriesAfterFailure.find(r => r.id === a.entryId);
  assert(releaseAfterFailure === "approved", "Failed release publish left release in publishing/partial state");
  assert(aAfter.status === "approved" && aAfter.published_version_id === a.priorVersionId && aAfter.current_draft_version_id === a.targetVersionId, "Failed release publish partially published the first item");
  assert((await client.query(`select bool_and(delivery_status='pending') ok from release_items where release_id=$1`, [releaseId])).rows[0].ok === true, "Failed release publish partially changed delivery status");
  assert(Number((await client.query(`select count(*)::int c from platform_audit_events where workspace_id=$1`, [workspaceId])).rows[0].c) === auditBeforeFailedPublish, "Failed release publish leaked audit rows");
  assert(Number((await client.query(`select count(*)::int c from release_history where release_id=$1`, [releaseId])).rows[0].c) === historyBeforeFailedPublish, "Failed release publish leaked release history");
  console.log("[PASS] Forced mid-release failure preserved exact previous state: no partial publish, no partial delivery status, no audit/history leak.");

  console.log("\n--- 6. Exact pinned-version release publication ---");
  await client.query(`update content_entries set current_draft_version_id=$2,status='approved' where id=$1`, [b.entryId, b.targetVersionId]);
  const publishResult = (await client.query(`select cms_publish_release($1,$2,$3) as result`, [workspaceId, reviewer.adminUserId, releaseId])).rows[0].result;
  assert(publishResult.status === "published" && publishResult.published_items === 2, "Release publication did not report two published items");
  const publishedEntries = (await client.query(`select id,status,published_version_id from content_entries where id=any($1::uuid[])`, [[a.entryId,b.entryId]])).rows;
  assert(publishedEntries.every(r => r.status === "published"), "Not all release entries are published");
  assert(publishedEntries.find(r => r.id === a.entryId).published_version_id === a.targetVersionId, "Release A published a non-pinned version");
  assert(publishedEntries.find(r => r.id === b.entryId).published_version_id === b.targetVersionId, "Release B published a non-pinned version");
  assert((await client.query(`select bool_and(delivery_status='published') ok from release_items where release_id=$1`, [releaseId])).rows[0].ok === true, "Release item delivery statuses were not completed");
  console.log("[PASS] Release published exactly the two pinned versions and completed item delivery state.");

  console.log("\n--- 7. Scheduling, calendar, assignment, notification ---");
  const c = await createReleaseEntry(modelId, requester.adminUserId, "Scheduled Release C");
  const scheduledRelease = (await client.query(`select cms_create_release($1,$2,'Scheduled Phase 8 release','schedule cert',$3::jsonb,'["en"]'::jsonb) as result`, [workspaceId, requester.adminUserId, JSON.stringify([c.targetVersionId])])).rows[0].result;
  const scheduledReleaseId = scheduledRelease.id;
  await client.query(`select cms_assign_release($1,$2,$3,$4,'publisher',null,'Own scheduled release')`, [workspaceId, requester.adminUserId, scheduledReleaseId, reviewer.adminUserId]);
  assert(Number((await client.query(`select count(*)::int c from editorial_notifications where release_id=$1 and recipient_admin_user_id=$2 and kind='release'`, [scheduledReleaseId, reviewer.adminUserId])).rows[0].c) >= 1, "Release assignment did not create notification");
  await client.query(`select cms_transition_release($1,$2,$3,'approve',null,'Ready')`, [workspaceId, reviewer.adminUserId, scheduledReleaseId]);
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await client.query(`select cms_transition_release($1,$2,$3,'schedule',$4,'Scheduled')`, [workspaceId, reviewer.adminUserId, scheduledReleaseId, future]);
  const calendar = (await client.query(`select status,starts_at from editorial_calendar_events where release_id=$1 and kind='release' order by created_at desc limit 1`, [scheduledReleaseId])).rows[0];
  assert(calendar?.status === "scheduled", "Scheduling did not create an editorial calendar event");
  await expectPgFailure("Publish scheduled release before due time", () => client.query(`select cms_publish_release($1,$2,$3)`, [workspaceId, reviewer.adminUserId, scheduledReleaseId]), "not due yet");
  assert((await client.query(`select status from releases where id=$1`, [scheduledReleaseId])).rows[0].status === "scheduled", "Early publish failure changed scheduled release state");
  await client.query(`select cms_transition_release($1,$2,$3,'request_changes',null,'Needs revision')`, [workspaceId, reviewer.adminUserId, scheduledReleaseId]);
  assert((await client.query(`select status from releases where id=$1`, [scheduledReleaseId])).rows[0].status === "draft", "Request changes did not return scheduled release to draft");
  assert((await client.query(`select status from editorial_calendar_events where release_id=$1 and kind='release' order by created_at desc limit 1`, [scheduledReleaseId])).rows[0].status === "cancelled", "Request changes did not cancel scheduled calendar event");
  console.log("[PASS] Release assignment, notification, scheduling, not-due rejection, and calendar cancellation certified.");

  console.log("\nPHASE 8 LIVE DATABASE CERTIFICATION: ALL PASSED");
} finally {
  try {
    await teardownCertification({ client, workspaceId, authUserIds, adminUserIds });
  } finally {
    await client.end();
  }
}
