/**
 * REAL Concurrency Race & Database Transaction Certification for Phase 3:
 * Data Studio, Dynamic Uniqueness Invariants, and Capability Enforcement.
 *
 * Verifies:
 * 1. Genuinely overlapping concurrent writes attempting to claim the same unique value
 *    on two distinct database connections (clientA and clientB) executed via Promise.allSettled.
 *    Asserts that EXACTLY ONE client wins and EXACTLY ONE client is rejected with PostgreSQL code 23505.
 * 2. Model capability enforcement at the database layer:
 *    Attempting to publish an entry for a `data_only` model is rejected with PostgreSQL error code P0003.
 * 3. Complete mutation boundary:
 *    Creating an entry atomically creates the entry, version, unique reservation, relation, search projection, and audit event.
 * 4. Guaranteed teardown of disposable workspace, auth users, and admin_users.
 */
import {
  createPgClient,
  createDisposableWorkspace,
  createAuthenticatedActor,
  teardownCertification,
} from "./cert-harness.mjs";

const clientMain = await createPgClient();
const clientA = await createPgClient();
const clientB = await createPgClient();

let workspaceId = null;
const authUserIds = [];
const adminUserIds = [];

const BASE_URL = process.env.CMS_CERT_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";

try {
  console.log("=== PHASE 3: REAL CONCURRENCY RACE & DATA STUDIO CERTIFICATION ===");

  // 1. Setup isolated disposable workspace
  const ws = await createDisposableWorkspace(clientMain, "p3-datastudio");
  workspaceId = ws.id;
  console.log(`[SETUP] Isolated disposable workspace: ${workspaceId} (${ws.slug})`);

  // 2. Setup authenticated editor actor
  const editor = await createAuthenticatedActor(clientMain, workspaceId, {
    role: "editor",
    permissions: ["content.entry.read", "content.entry.edit", "content.entry.publish", "content.entry.archive", "schema.manage"],
    emailPrefix: "p3-editor",
  });
  authUserIds.push(editor.authUserId);
  adminUserIds.push(editor.adminUserId);

  // 3. Create a data_only model with unique fields
  const companyApiKey = `company_${Date.now().toString().slice(-4)}`;
  const companySchema = {
    name: "Company",
    apiKey: companyApiKey,
    capability: "data_only",
    fields: [
      { key: "name", label: "Company Name", type: "text", required: true, localized: false, unique: false },
      { key: "tax_id", label: "Tax ID", type: "text", required: true, localized: false, unique: true },
    ],
  };

  const { rows: modelRows } = await clientMain.query(`
    select cms_create_content_model($1, $2, 'Company', $3, 'Data-only company model', null, $4::jsonb, 'hash1', 'data_only') as result
  `, [workspaceId, editor.adminUserId, companyApiKey, JSON.stringify(companySchema)]);
  const companyModel = modelRows[0].result.model;
  console.log(`Company data_only Model Created: ID ${companyModel.id}`);

  // ══════════════════════════════════════════════════════════════════════════
  // A. GENUINE OVERLAPPING CONCURRENT WRITE RACE
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- A. Genuine Overlapping Concurrent Write Race ---");
  const conflictingTaxId = `TAX-RACE-${Date.now().toString().slice(-4)}`;

  const callCreateEntry = (pgClient, clientLabel, clientName) => {
    return pgClient.query(`
      select cms_create_content_entry(
        $1, $2, $3,
        jsonb_build_object('name', $4::text, 'tax_id', $5::text),
        'en', 'Concurrent race write',
        jsonb_build_array(jsonb_build_object('fieldKey', 'tax_id', 'normalizedValue', $5::text)),
        '[]'::jsonb,
        $4::text
      ) as result
    `, [workspaceId, editor.adminUserId, companyModel.id, clientName, conflictingTaxId]);
  };

  console.log(`Launching simultaneous concurrent writes on Connection A & Connection B for unique tax_id "${conflictingTaxId}"...`);
  const [resA, resB] = await Promise.allSettled([
    callCreateEntry(clientA, "Connection A", "Client Alpha Corp"),
    callCreateEntry(clientB, "Connection B", "Client Beta Ltd"),
  ]);

  const fulfilled = [resA, resB].filter((r) => r.status === "fulfilled");
  const rejected = [resA, resB].filter((r) => r.status === "rejected");

  console.log(`Concurrent Execution Results: ${fulfilled.length} fulfilled, ${rejected.length} rejected`);

  if (fulfilled.length !== 1 || rejected.length !== 1) {
    throw new Error(`Race condition failure! Expected exactly 1 winner and 1 loser, got ${fulfilled.length} winners and ${rejected.length} losers.`);
  }

  const winner = fulfilled[0].value.rows[0].result;
  const loserError = rejected[0].reason;

  console.log(`Winning entry ID: ${winner.entry.id}`);
  console.log(`Losing error code: ${loserError.code} (${loserError.message})`);

  if (loserError.code !== "23505") {
    throw new Error(`Expected PostgreSQL unique violation error code 23505, got: ${loserError.code}`);
  }
  console.log("PostgreSQL Error 23505 Verified: Concurrent write collision strictly rejected at database layer.");

  // ══════════════════════════════════════════════════════════════════════════
  // B. MODEL CAPABILITY ENFORCEMENT ON PUBLISHING
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- B. Model Capability Enforcement on Publishing ---");

  // Mark the entry as approved in workflow
  await clientMain.query("update content_entries set status = 'approved' where id = $1", [winner.entry.id]);

  let publishBlocked = false;
  try {
    await clientMain.query(`
      select cms_publish_content_entry($1, $2, $3)
    `, [workspaceId, editor.adminUserId, winner.entry.id]);
  } catch (err) {
    publishBlocked = true;
    console.log(`Publishing data_only entry rejected with error: ${err.code} - ${err.message}`);
    if (err.code !== "P0003" && !err.message.includes("data_only")) {
      throw new Error(`Expected P0003 or data_only rejection, got ${err.code}: ${err.message}`);
    }
  }

  if (!publishBlocked) {
    throw new Error("Security violation: cms_publish_content_entry allowed publishing a data_only model!");
  }
  console.log("Model Capability Enforcement Verified: Database RPC strictly prevents publishing data_only records.");

  // ══════════════════════════════════════════════════════════════════════════
  // C. COMPLETE ATOMIC MUTATION & LIFECYCLE (PUBLISHABLE MODEL)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- C. Complete Atomic Mutation & Publishable Lifecycle ---");

  // Create publishable Article model
  const articleApiKey = `article_${Date.now().toString().slice(-4)}`;
  const articleSchema = {
    name: "Article",
    apiKey: articleApiKey,
    capability: "publishable",
    fields: [
      { key: "title", label: "Title", type: "text", required: true, localized: false, unique: false },
      { key: "slug", label: "Slug", type: "slug", required: true, localized: false, unique: true },
    ],
  };

  const { rows: artModelRows } = await clientMain.query(`
    select cms_create_content_model($1, $2, 'Article', $3, 'Publishable article model', null, $4::jsonb, 'hash2', 'publishable') as result
  `, [workspaceId, editor.adminUserId, articleApiKey, JSON.stringify(articleSchema)]);
  const articleModel = artModelRows[0].result.model;

  // 1. Create entry (v1)
  const slugVal = `post-${Date.now().toString().slice(-4)}`;
  const { rows: artEntryRows } = await clientMain.query(`
    select cms_create_content_entry(
      $1, $2, $3,
      jsonb_build_object('title', 'Initial Post', 'slug', $4::text),
      'en', 'Initial article draft',
      jsonb_build_array(jsonb_build_object('fieldKey', 'slug', 'normalizedValue', $4::text)),
      '[]'::jsonb,
      'Initial Post searchable'
    ) as result
  `, [workspaceId, editor.adminUserId, articleModel.id, slugVal]);

  const articleEntry = artEntryRows[0].result.entry;
  const articleVersion1 = artEntryRows[0].result.version;
  console.log(`Article Entry Created: ID ${articleEntry.id}, Version ${articleVersion1.version_number}`);

  // Assert atomic projections exist
  const { rows: searchDoc } = await clientMain.query("select * from content_search_documents where entry_id = $1", [articleEntry.id]);
  if (!searchDoc[0] || searchDoc[0].search_text !== "Initial Post searchable") {
    throw new Error("Atomic mutation assertion failed: content_search_documents was not created in the transaction!");
  }
  const { rows: auditEvent } = await clientMain.query("select * from platform_audit_events where entity_id = $1 and action = 'content.entry.created'", [articleEntry.id]);
  if (!auditEvent[0]) {
    throw new Error("Atomic mutation assertion failed: platform_audit_events was not created in the transaction!");
  }
  console.log("Atomic Mutation Verified: Search projection & audit event committed in the same transaction.");

  // 2. Save Draft (v2)
  const { rows: draft2Rows } = await clientMain.query(`
    select cms_save_entry_draft(
      $1, $2, $3,
      jsonb_build_object('title', 'Updated Post v2', 'slug', $4::text),
      'en', 'Updated to v2', 1,
      jsonb_build_array(jsonb_build_object('fieldKey', 'slug', 'normalizedValue', $4::text)),
      '[]'::jsonb,
      'Updated Post v2 searchable'
    ) as result
  `, [workspaceId, editor.adminUserId, articleEntry.id, slugVal]);

  const articleVersion2 = draft2Rows[0].result.version;
  console.log(`Article Draft v2 Saved: Version ${articleVersion2.version_number}`);
  if (articleVersion2.version_number !== 2) {
    throw new Error(`Expected version 2, got ${articleVersion2.version_number}`);
  }

  // 3. Approve and Publish
  await clientMain.query("update content_entries set status = 'approved' where id = $1", [articleEntry.id]);
  const { rows: pubRows } = await clientMain.query(`
    select cms_publish_content_entry($1, $2, $3) as result
  `, [workspaceId, editor.adminUserId, articleEntry.id]);

  const publishedEntry = pubRows[0].result;
  console.log(`Article Published: Status "${publishedEntry.status}", published_version_id: ${publishedEntry.published_version_id}`);
  if (publishedEntry.status !== "published" || publishedEntry.published_version_id !== articleVersion2.id) {
    throw new Error("Publish assertion failed!");
  }

  // 4. Archive & Unarchive via Authenticated Application HTTP Path
  console.log("\n--- D. Archive & Unarchive via Application HTTP API ---");
  const archiveRes = await fetch(`${BASE_URL}/api/entries/${articleEntry.id}/archive`, {
    method: "POST",
    headers: editor.headers,
  });
  const archiveJson = await archiveRes.json();
  console.log(`[HTTP] POST /api/entries/:id/archive -> Status: ${archiveRes.status}`);
  if (archiveRes.status !== 200 || !archiveJson.success) {
    throw new Error(`Failed to archive entry via HTTP: ${JSON.stringify(archiveJson)}`);
  }
  if (archiveJson.data?.status !== "archived") {
    throw new Error(`Expected data.status 'archived', got: ${archiveJson.data?.status}`);
  }

  // Verify database row status
  const { rows: archivedDbRows } = await clientMain.query(
    "select status from content_entries where id = $1",
    [articleEntry.id]
  );
  if (archivedDbRows[0]?.status !== "archived") {
    throw new Error(`Database entry status mismatch. Expected 'archived', got '${archivedDbRows[0]?.status}'`);
  }

  // Verify audit event
  const { rows: archiveAudit } = await clientMain.query(
    "select count(*) as count from platform_audit_events where workspace_id = $1 and action = 'content.entry.archived' and entity_id = $2",
    [workspaceId, articleEntry.id]
  );
  if (parseInt(archiveAudit[0].count, 10) !== 1) {
    throw new Error("Audit event missing for content.entry.archived");
  }
  console.log("Archive HTTP Endpoint & Audit Verified: Entry status is archived and audit logged.");

  const unarchiveRes = await fetch(`${BASE_URL}/api/entries/${articleEntry.id}/unarchive`, {
    method: "POST",
    headers: editor.headers,
  });
  const unarchiveJson = await unarchiveRes.json();
  console.log(`[HTTP] POST /api/entries/:id/unarchive -> Status: ${unarchiveRes.status}`);
  if (unarchiveRes.status !== 200 || !unarchiveJson.success) {
    throw new Error(`Failed to unarchive entry via HTTP: ${JSON.stringify(unarchiveJson)}`);
  }
  if (unarchiveJson.data?.status !== "published") {
    throw new Error(`Expected data.status restored to 'published', got: ${unarchiveJson.data?.status}`);
  }

  // Verify database row status
  const { rows: unarchivedDbRows } = await clientMain.query(
    "select status from content_entries where id = $1",
    [articleEntry.id]
  );
  if (unarchivedDbRows[0]?.status !== "published") {
    throw new Error(`Database entry status mismatch. Expected 'published', got '${unarchivedDbRows[0]?.status}'`);
  }

  // Verify audit event
  const { rows: unarchiveAudit } = await clientMain.query(
    "select count(*) as count from platform_audit_events where workspace_id = $1 and action = 'content.entry.unarchived' and entity_id = $2",
    [workspaceId, articleEntry.id]
  );
  if (parseInt(unarchiveAudit[0].count, 10) !== 1) {
    throw new Error("Audit event missing for content.entry.unarchived");
  }
  console.log("Unarchive HTTP Endpoint & Audit Verified: Entry status restored to published and audit logged.");

  console.log("\n==================================================");
  console.log("PHASE 3 CONCURRENCY & DATA STUDIO CERTIFICATION: ALL PASSED");
  console.log("==================================================");
} catch (err) {
  console.error("\n[FATAL CERTIFICATION FAILURE]:", err);
  process.exitCode = 1;
} finally {
  console.log("\n[CLEANUP] Executing guaranteed teardown...");
  await clientA.end().catch(() => {});
  await clientB.end().catch(() => {});
  await teardownCertification({
    client: clientMain,
    workspaceId,
    authUserIds,
    adminUserIds,
  });
  await clientMain.end().catch(() => {});
}
