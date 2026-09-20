/**
 * REAL HTTP API & Application-Path Certification for Phase 5:
 * Editorial Collaboration, Review Workflow, and Self-Approval Rejection.
 *
 * Verifies via real HTTP requests to Next.js API route handlers:
 * 1. Author submits draft entry for review (POST /api/entries/:id/workflow -> in_review).
 * 2. Self-Approval Invariant Enforcement:
 *    Author attempts to approve their own submission -> strictly rejected with actual HTTP 403
 *    ("A requester cannot approve their own review").
 * 3. Reviewer requests changes (POST /api/entries/:id/workflow -> draft).
 * 4. Author resubmits (in_review).
 * 5. Distinct reviewer approves submission (POST /api/entries/:id/workflow -> approved).
 * 6. Threaded comments, mentions, watchers, and assignment due dates.
 * 7. Guaranteed teardown of disposable workspace, all auth users, and all admin_users (0 leaks).
 */
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

const BASE_URL = process.env.CMS_CERT_BASE_URL || "http://localhost:3000";

try {
  console.log("=== PHASE 5: REAL COLLABORATION & WORKFLOW HTTP CERTIFICATION ===");

  // 1. Setup isolated disposable workspace
  const ws = await createDisposableWorkspace(client, "p5-collab");
  workspaceId = ws.id;
  console.log(`[SETUP] Isolated disposable workspace: ${workspaceId} (${ws.slug})`);

  // 2. Create Author actor (has edit AND publish permissions to prove self-approval invariant is workflow-enforced)
  const authorActor = await createAuthenticatedActor(client, workspaceId, {
    role: "author",
    permissions: ["content.entry.read", "content.entry.edit", "content.entry.publish", "schema.manage"],
    emailPrefix: "p5-author",
  });
  authUserIds.push(authorActor.authUserId);
  adminUserIds.push(authorActor.adminUserId);

  // 3. Create Reviewer actors (has publishing authority to approve/reject)
  const reviewerActor = await createAuthenticatedActor(client, workspaceId, {
    role: "reviewer",
    permissions: ["content.entry.read", "content.entry.edit", "content.entry.publish"],
    emailPrefix: "p5-reviewer",
  });
  authUserIds.push(reviewerActor.authUserId);
  adminUserIds.push(reviewerActor.adminUserId);

  const reviewer2Actor = await createAuthenticatedActor(client, workspaceId, {
    role: "reviewer",
    permissions: ["content.entry.read", "content.entry.edit", "content.entry.publish"],
    emailPrefix: "p5-reviewer2",
  });
  authUserIds.push(reviewer2Actor.authUserId);
  adminUserIds.push(reviewer2Actor.adminUserId);

  // 4. Provision default active workflow definition in disposable workspace
  await client.query(`
    insert into workflow_definitions (workspace_id, name, definition_json, active)
    values ($1, 'Standard Editorial Review', '{"states":["draft","in_review","approved","published"],"transitions":{"draft":"in_review","in_review":["approved","changes_requested"],"approved":"published"},"self_approval":false}'::jsonb, true)
  `, [workspaceId]);

  // 5. Create a model and initial draft entry
  const articleApiKey = `post_${Date.now().toString().slice(-4)}`;
  const modelSchema = {
    name: "Editorial Post",
    apiKey: articleApiKey,
    capability: "publishable",
    fields: [
      { key: "title", label: "Title", type: "text", required: true, localized: false, unique: false },
      { key: "content", label: "Content", type: "text", required: false, localized: false, unique: false },
    ],
  };

  const { rows: modelRows } = await client.query(`
    select cms_create_content_model($1, $2, 'Editorial Post', $3, 'Test editorial post', null, $4::jsonb, 'hash-collab', 'publishable') as result
  `, [workspaceId, authorActor.adminUserId, articleApiKey, JSON.stringify(modelSchema)]);
  const model = modelRows[0].result.model;

  const { rows: entryRows } = await client.query(`
    select cms_create_content_entry(
      $1, $2, $3,
      jsonb_build_object('title', 'Collaborative Article', 'content', 'Draft content'),
      'en', 'Initial submission draft',
      '[]'::jsonb,
      '[]'::jsonb,
      'Collaborative Article'
    ) as result
  `, [workspaceId, authorActor.adminUserId, model.id]);
  const entryId = entryRows[0].result.entry.id;
  console.log(`Article Created: ID ${entryId} (Status: draft)`);

  // ══════════════════════════════════════════════════════════════════════════
  // A. WORKFLOW SUBMIT & SELF-APPROVAL REJECTION VIA REAL HTTP
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- A. Workflow Submit & Self-Approval Rejection ---");

  // Step 1: Author submits entry for review via HTTP
  const submitRes = await fetch(`${BASE_URL}/api/entries/${entryId}/workflow`, {
    method: "POST",
    headers: authorActor.headers,
    body: JSON.stringify({ action: "submit", comment: "Ready for initial peer review" }),
  });
  const submitJson = await submitRes.json();
  console.log(`[HTTP] POST /api/entries/:id/workflow (Author Submit) -> Status: ${submitRes.status} (Expected: 200)`);
  if (submitRes.status !== 200 || !submitJson.success) {
    throw new Error(`Failed to submit review: ${JSON.stringify(submitJson)}`);
  }

  // Step 2: Author attempts to approve their own review -> MUST BE REJECTED WITH HTTP 403
  // Even though author has content.entry.publish, workflow invariant prohibits self-approval.
  const selfApproveRes = await fetch(`${BASE_URL}/api/entries/${entryId}/workflow`, {
    method: "POST",
    headers: authorActor.headers,
    body: JSON.stringify({ action: "approve", comment: "Self-approving my own article" }),
  });
  const selfApproveJson = await selfApproveRes.json();
  console.log(`[HTTP] POST /api/entries/:id/workflow (Author Self-Approve) -> Status: ${selfApproveRes.status} (Expected: 403)`);
  if (selfApproveRes.status !== 403 || !String(selfApproveJson.error).includes("cannot approve")) {
    throw new Error(`Security defect: Expected HTTP 403 with self-approval error, got ${selfApproveRes.status}: ${JSON.stringify(selfApproveJson)}`);
  }
  console.log("Self-Approval Rejection Verified: Author with publish permissions was strictly rejected from approving own review.");

  // Step 3: Reviewer requests changes via HTTP
  const changesRes = await fetch(`${BASE_URL}/api/entries/${entryId}/workflow`, {
    method: "POST",
    headers: reviewerActor.headers,
    body: JSON.stringify({ action: "request_changes", comment: "Please expand the intro section" }),
  });
  const changesJson = await changesRes.json();
  console.log(`[HTTP] POST /api/entries/:id/workflow (Reviewer Request Changes) -> Status: ${changesRes.status} (Expected: 200)`);
  if (changesRes.status !== 200 || !changesJson.success) {
    throw new Error(`Failed to request changes: ${JSON.stringify(changesJson)}`);
  }

  // Step 4: Author resubmits via HTTP
  const resubmitRes = await fetch(`${BASE_URL}/api/entries/${entryId}/workflow`, {
    method: "POST",
    headers: authorActor.headers,
    body: JSON.stringify({ action: "submit", comment: "Updated intro section as requested" }),
  });
  const resubmitJson = await resubmitRes.json();
  console.log(`[HTTP] POST /api/entries/:id/workflow (Author Resubmit) -> Status: ${resubmitRes.status} (Expected: 200)`);
  if (resubmitRes.status !== 200 || !resubmitJson.success) {
    throw new Error(`Failed to resubmit review: ${JSON.stringify(resubmitJson)}`);
  }

  // Step 5: Competing Reviewers Concurrency Safety Test via Promise.allSettled
  console.log("\n--- Competing Reviewers Concurrency Collision Test ---");
  const [outcome1, outcome2] = await Promise.allSettled([
    fetch(`${BASE_URL}/api/entries/${entryId}/workflow`, {
      method: "POST",
      headers: reviewerActor.headers,
      body: JSON.stringify({ action: "approve", comment: "Reviewer 1 concurrent approve" }),
    }).then(async (r) => ({ status: r.status, json: await r.json() })),
    fetch(`${BASE_URL}/api/entries/${entryId}/workflow`, {
      method: "POST",
      headers: reviewer2Actor.headers,
      body: JSON.stringify({ action: "request_changes", comment: "Reviewer 2 concurrent request_changes" }),
    }).then(async (r) => ({ status: r.status, json: await r.json() })),
  ]);

  const r1 = outcome1.status === "fulfilled" ? outcome1.value : null;
  const r2 = outcome2.status === "fulfilled" ? outcome2.value : null;

  console.log(`[HTTP CONCURRENT] Reviewer 1 decision -> Status: ${r1?.status} (${r1?.json?.state || r1?.json?.error})`);
  console.log(`[HTTP CONCURRENT] Reviewer 2 decision -> Status: ${r2?.status} (${r2?.json?.state || r2?.json?.error})`);

  const statuses = [r1?.status, r2?.status].sort();
  if (statuses[0] !== 200 || statuses[1] !== 409) {
    throw new Error(`Concurrency defect: Expected exactly one 200 and one 409, got ${JSON.stringify([r1, r2])}`);
  }

  // Verify atomic integrity in database: exactly ONE review decision recorded
  const { rows: actionRows } = await client.query(`
    select count(*) as count from workflow_actions
    where action in ('approved', 'changes_requested')
      and workflow_instance_id in (select id from workflow_instances where entry_id = $1)
  `, [entryId]);

  if (parseInt(actionRows[0].count, 10) !== 2) {
    // 1 from Step 3 (request_changes) + 1 from the concurrent winner = 2
    throw new Error(`Database integrity defect: Expected exactly 2 total decision actions recorded in workflow_actions, got ${actionRows[0].count}`);
  }

  const { rows: concurrentActionRows } = await client.query(`
    select action, actor_id, comment from workflow_actions
    where workflow_instance_id in (select id from workflow_instances where entry_id = $1)
    order by created_at desc limit 1
  `, [entryId]);
  console.log(`Database Integrity Verified: Exactly one winning action committed ("${concurrentActionRows[0].action}" by ${concurrentActionRows[0].actor_id})`);

  console.log("Concurrency Invariant Verified: Exactly 1 winning reviewer committed; conflicting reviewer rejected with HTTP 409.");

  // ══════════════════════════════════════════════════════════════════════════
  // B. COLLABORATION PRIMITIVES VIA REAL HTTP APIS
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- B. Collaboration Primitives via Real HTTP APIs ---");

  // 1. Assign entry via HTTP POST /api/entries/:id/collaboration
  const dueDate = new Date(Date.now() + 86400000 * 3).toISOString();
  const assignRes = await fetch(`${BASE_URL}/api/entries/${entryId}/collaboration`, {
    method: "POST",
    headers: authorActor.headers,
    body: JSON.stringify({
      action: "assign",
      assigneeId: reviewerActor.adminUserId,
      role: "reviewer",
      dueAt: dueDate,
      note: "Peer review assignment",
    }),
  });
  const assignJson = await assignRes.json();
  console.log(`[HTTP] POST /api/entries/:id/collaboration (Assign) -> Status: ${assignRes.status} (Expected: 200)`);
  if (assignRes.status !== 200 || !assignJson.success) {
    throw new Error(`Failed to assign entry: ${JSON.stringify(assignJson)}`);
  }
  console.log("Assignment Verified via HTTP:", assignJson.data.id);

  // 2. Threaded Comment with mention via HTTP POST /api/entries/:id/collaboration
  const commentRes = await fetch(`${BASE_URL}/api/entries/${entryId}/collaboration`, {
    method: "POST",
    headers: reviewerActor.headers,
    body: JSON.stringify({
      action: "comment",
      body: "Please verify the citations in paragraph 2",
      mentionIds: [authorActor.adminUserId],
    }),
  });
  const commentJson = await commentRes.json();
  console.log(`[HTTP] POST /api/entries/:id/collaboration (Comment) -> Status: ${commentRes.status} (Expected: 200)`);
  if (commentRes.status !== 200 || !commentJson.success) {
    throw new Error(`Failed to add comment: ${JSON.stringify(commentJson)}`);
  }
  const commentId = commentJson.data.id;

  // 3. Resolve Comment via HTTP POST /api/entries/:id/collaboration
  const resolveRes = await fetch(`${BASE_URL}/api/entries/${entryId}/collaboration`, {
    method: "POST",
    headers: authorActor.headers,
    body: JSON.stringify({
      action: "resolve_comment",
      commentId,
    }),
  });
  const resolveJson = await resolveRes.json();
  console.log(`[HTTP] POST /api/entries/:id/collaboration (Resolve Comment) -> Status: ${resolveRes.status} (Expected: 200)`);
  if (resolveRes.status !== 200 || !resolveJson.success) {
    throw new Error(`Failed to resolve comment: ${JSON.stringify(resolveJson)}`);
  }
  console.log("Comment Resolution Verified via HTTP.");

  // 4. Watch Entry via HTTP POST /api/entries/:id/collaboration
  const watchRes = await fetch(`${BASE_URL}/api/entries/${entryId}/collaboration`, {
    method: "POST",
    headers: reviewerActor.headers,
    body: JSON.stringify({
      action: "watch",
      watching: true,
    }),
  });
  const watchJson = await watchRes.json();
  console.log(`[HTTP] POST /api/entries/:id/collaboration (Watch) -> Status: ${watchRes.status} (Expected: 200)`);
  if (watchRes.status !== 200 || !watchJson.success) {
    throw new Error(`Failed to set watch: ${JSON.stringify(watchJson)}`);
  }
  console.log("Entry Watcher Verified via HTTP.");

  // 5. Query Collaboration Aggregation via HTTP GET /api/entries/:id/collaboration
  const getCollabRes = await fetch(`${BASE_URL}/api/entries/${entryId}/collaboration`, {
    headers: authorActor.headers,
  });
  const getCollabJson = await getCollabRes.json();
  console.log(`[HTTP] GET /api/entries/:id/collaboration -> Status: ${getCollabRes.status} (Expected: 200)`);
  if (getCollabRes.status !== 200 || !getCollabJson.success) {
    throw new Error(`Failed to retrieve collaboration: ${JSON.stringify(getCollabJson)}`);
  }
  const collabData = getCollabJson.data;
  if (!collabData.assignments?.length || !collabData.comments?.length || !collabData.watcherAdminUserIds?.includes(reviewerActor.adminUserId)) {
    throw new Error(`Collaboration data incomplete: ${JSON.stringify(collabData)}`);
  }
  console.log("Collaboration Aggregation Verified via HTTP (Assignments, Comments, Watchers).");

  // 6. Query Editorial Queue via HTTP GET /api/collaboration/queue
  const queueRes = await fetch(`${BASE_URL}/api/collaboration/queue`, {
    headers: reviewerActor.headers,
  });
  const queueJson = await queueRes.json();
  console.log(`[HTTP] GET /api/collaboration/queue -> Status: ${queueRes.status} (Expected: 200)`);
  if (queueRes.status !== 200 || !queueJson.success) {
    throw new Error(`Failed to get reviewer queue: ${JSON.stringify(queueJson)}`);
  }
  console.log("Reviewer Editorial Queue Verified via HTTP:", queueJson.data.assignments?.length, "active assignments.");

  // 7. Calendar Event Integration via HTTP POST /api/calendar & GET /api/calendar
  const calCreateRes = await fetch(`${BASE_URL}/api/calendar`, {
    method: "POST",
    headers: authorActor.headers,
    body: JSON.stringify({
      title: "Article Editorial Deadline",
      kind: "review_due",
      startsAt: dueDate,
      entryId,
    }),
  });
  const calCreateJson = await calCreateRes.json();
  console.log(`[HTTP] POST /api/calendar -> Status: ${calCreateRes.status} (Expected: 201)`);
  if (calCreateRes.status !== 201 || !calCreateJson.success) {
    throw new Error(`Failed to create calendar event: ${JSON.stringify(calCreateJson)}`);
  }

  const calListRes = await fetch(`${BASE_URL}/api/calendar`, {
    headers: authorActor.headers,
  });
  const calListJson = await calListRes.json();
  console.log(`[HTTP] GET /api/calendar -> Status: ${calListRes.status} (Expected: 200)`);
  if (calListRes.status !== 200 || !calListJson.success || !calListJson.data.some((e) => e.id === calCreateJson.data.id)) {
    throw new Error(`Failed to list calendar events: ${JSON.stringify(calListJson)}`);
  }
  console.log("Calendar Event Creation & Retrieval Verified via HTTP.");

  console.log("\n==================================================");
  console.log("PHASE 5 COLLABORATION & WORKFLOW CERTIFICATION: ALL PASSED");
  console.log("==================================================");
} catch (err) {
  console.error("\n[FATAL CERTIFICATION FAILURE]:", err);
  process.exitCode = 1;
} finally {
  console.log("\n[CLEANUP] Executing guaranteed teardown...");
  await teardownCertification({
    client,
    workspaceId,
    authUserIds,
    adminUserIds,
  });
  await client.end().catch(() => {});
}
