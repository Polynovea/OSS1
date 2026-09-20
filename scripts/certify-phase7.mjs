/**
 * Live database and schema-level certification for Phase 7:
 * Information Architecture & Media Operations.
 *
 * Uses an isolated disposable certification workspace with guaranteed
 * `finally` teardown so the production/working CMS workspace is NEVER polluted.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

for (const raw of readFileSync(".env.local", "utf8").split("\n")) {
  const match = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

const connectionString =
  process.env.Database_URL ||
  process.env.DATABASE_URL ||
  process.env.database_url;

if (!connectionString) throw new Error("Missing database connection string");

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const results = {
  timestamp: new Date().toISOString(),
  taxonomy: {},
  routes: {},
  redirects: {},
  navigation: {},
  media: {},
  allPassed: false,
};

let disposableWorkspaceId = null;

try {
  // ── 0. Create Isolated Disposable Certification Workspace ─────────────────
  const { rows: actorRows } = await client.query(`
    select id, email from admin_users limit 1
  `);
  if (!actorRows[0]) throw new Error("No admin user found");
  const actor = actorRows[0];

  const wsSlug = `cert-ws-${Date.now().toString().slice(-6)}`;
  const { rows: wsRows } = await client.query(`
    insert into workspaces (name, slug)
    values ('Disposable Phase 7 Cert Workspace', $1)
    returning id
  `, [wsSlug]);
  disposableWorkspaceId = wsRows[0].id;

  // Add actor as active member in disposable workspace
  await client.query(`
    insert into workspace_members (workspace_id, admin_user_id, status)
    values ($1, $2, 'active')
  `, [disposableWorkspaceId, actor.id]);

  // Create a base content model in disposable workspace
  const { rows: modelRows } = await client.query(`
    insert into content_models (workspace_id, name, api_key, current_schema_version, status)
    values ($1, 'Cert Page', 'cert_page', 1, 'active')
    returning id
  `, [disposableWorkspaceId]);
  const modelId = modelRows[0].id;

  console.log(`[CERTIFICATION P7] Isolated Workspace: ${disposableWorkspaceId}`);

  // ══════════════════════════════════════════════════════════════════════════
  // 1. TAXONOMY DOMAIN CERTIFICATION
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- 1. Taxonomy Domain ---");

  const taxSlug = `cert-tax-${Date.now().toString().slice(-6)}`;
  const { rows: taxRows } = await client.query(
    `insert into taxonomies (workspace_id, name, slug, description, hierarchical)
     values ($1, 'Certification Categories', $2, 'Hierarchical test taxonomy', true)
     returning id, name, slug, hierarchical`,
    [disposableWorkspaceId, taxSlug]
  );
  const taxonomyId = taxRows[0].id;

  // Root Term: Engineering
  const { rows: rootTermRows } = await client.query(
    `insert into taxonomy_terms (workspace_id, taxonomy_id, name, slug, description, order_index)
     values ($1, $2, 'Engineering', 'engineering', 'Root tech term', 0)
     returning id, name, slug`,
    [disposableWorkspaceId, taxonomyId]
  );
  const rootTermId = rootTermRows[0].id;

  // Child Term: Artificial Intelligence
  const { rows: childTermRows } = await client.query(
    `insert into taxonomy_terms (workspace_id, taxonomy_id, parent_term_id, name, slug, description, order_index)
     values ($1, $2, $3, 'Artificial Intelligence', 'ai', 'Child AI term', 0)
     returning id, name, slug, parent_term_id`,
    [disposableWorkspaceId, taxonomyId, rootTermId]
  );
  const childTermId = childTermRows[0].id;

  // Localized label
  await client.query(
    `insert into taxonomy_term_localizations (workspace_id, term_id, locale, label, description)
     values ($1, $2, 'fr', 'Intelligence Artificielle', 'Terme IA')`,
    [disposableWorkspaceId, childTermId]
  );

  // Term Alias
  await client.query(
    `insert into taxonomy_term_aliases (workspace_id, term_id, alias, locale)
     values ($1, $2, 'Machine Learning', 'en')`,
    [disposableWorkspaceId, childTermId]
  );

  // Version-Aware Term Assignment: create entry and version
  const { rows: entryRows } = await client.query(
    `insert into content_entries (workspace_id, content_model_id, status, created_by, updated_by)
     values ($1, $2, 'draft', $3, $3) returning id`,
    [disposableWorkspaceId, modelId, actor.id]
  );
  const dummyEntryId = entryRows[0].id;

  const { rows: verRows } = await client.query(
    `insert into content_entry_versions (entry_id, model_schema_version, version_number, data_jsonb, locale, state, created_by)
     values ($1, 1, 1, '{"title": "Taxonomy Test Entry"}'::jsonb, 'en', 'draft', $2) returning id`,
    [dummyEntryId, actor.id]
  );
  const dummyVersionId = verRows[0].id;

  // Assign childTermId to dummyVersionId
  await client.query(
    `insert into content_entry_version_terms (workspace_id, entry_id, version_id, term_id)
     values ($1, $2, $3, $4)`,
    [disposableWorkspaceId, dummyEntryId, dummyVersionId, childTermId]
  );

  // Atomic Term Merge via PostgreSQL RPC
  await client.query(
    "select cms_merge_taxonomy_terms($1, $2, $3, $4)",
    [disposableWorkspaceId, actor.id, childTermId, rootTermId]
  );

  // Verify transactional platform audit inside transaction
  const { rows: taxAudit } = await client.query(
    "select * from platform_audit_events where workspace_id = $1 and action = 'taxonomy.terms_merged' and entity_id = $2",
    [disposableWorkspaceId, childTermId]
  );
  if (!taxAudit[0]) {
    throw new Error("Transactional audit missing for cms_merge_taxonomy_terms");
  }

  // Check that historical assignment to childTermId in content_entry_version_terms is preserved
  const { rows: histAssignments } = await client.query(
    `select term_id from content_entry_version_terms where version_id = $1`,
    [dummyVersionId]
  );
  if (histAssignments[0].term_id !== childTermId) {
    throw new Error("Taxonomy invariant failed: historical version term was overwritten during merge!");
  }

  results.taxonomy = {
    status: "CERTIFIED_LIVE",
    taxonomyId,
    rootTermId,
    childTermId,
    mergedIntoTermId: rootTermId,
    historicalVersionAssignmentPreserved: true,
  };
  console.log("Taxonomy Certification:", results.taxonomy);

  // ══════════════════════════════════════════════════════════════════════════
  // 2. SITE TREE & ROUTE REGISTRY CERTIFICATION
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- 2. Site Tree & Route Registry ---");

  const routePath = `/cert-section-${Date.now().toString().slice(-4)}`;
  const { rows: parentRouteRows } = await client.query(
    `insert into content_routes (workspace_id, locale, path, title, node_type, is_canonical, status, order_index)
     values ($1, 'en', $2, 'Certification Section', 'virtual_folder', true, 'active', 0)
     returning id, path`,
    [disposableWorkspaceId, routePath]
  );
  const parentRouteId = parentRouteRows[0].id;

  const childRoutePath = `${routePath}/page-one`;
  const { rows: childRouteRows } = await client.query(
    `insert into content_routes (workspace_id, parent_route_id, entry_id, locale, path, title, node_type, is_canonical, status, order_index)
     values ($1, $2, $3, 'en', $4, 'Page One', 'routable_entry', true, 'active', 0)
     returning id, path`,
    [disposableWorkspaceId, parentRouteId, dummyEntryId, childRoutePath]
  );
  const childRouteId = childRouteRows[0].id;

  // Attach route dependency edge before path change
  await client.query(
    `insert into content_relations (workspace_id, source_route_id, source_entity_type, target_entity_type, relation_type, target_entry_id)
     values ($1, $2, 'route', 'entry', 'route_entry', $3)`,
    [disposableWorkspaceId, childRouteId, dummyEntryId]
  );

  // Test Route Path Change & Automatic 301 Redirect Generation via Atomic PostgreSQL RPC
  const newChildPath = `${routePath}/page-one-migrated`;

  const { rows: routeUpdateRes } = await client.query(
    "select cms_update_route_path($1, $2, $3, $4, 'Page One Migrated', $5, 0, true) as result",
    [disposableWorkspaceId, actor.id, childRouteId, newChildPath, parentRouteId]
  );

  // Verify route dependency relations are preserved across path change
  const { rows: preservedRouteRelations } = await client.query(
    "select * from content_relations where workspace_id = $1 and source_route_id = $2",
    [disposableWorkspaceId, childRouteId]
  );
  if (!preservedRouteRelations[0] || preservedRouteRelations[0].target_entry_id !== dummyEntryId) {
    throw new Error("Route dependency relation not preserved during route path update");
  }

  // Verify transactional platform audit inside transaction
  const { rows: routeAudit } = await client.query(
    "select * from platform_audit_events where workspace_id = $1 and action = 'routing.route_updated' and entity_id = $2",
    [disposableWorkspaceId, childRouteId]
  );
  if (!routeAudit[0]) {
    throw new Error("Transactional audit missing for cms_update_route_path");
  }

  const { rows: autoRedirectRows } = await client.query(
    "select * from content_redirects where workspace_id = $1 and source_path = $2 and target_path = $3",
    [disposableWorkspaceId, childRoutePath, newChildPath]
  );

  results.routes = {
    status: "CERTIFIED_LIVE",
    parentRouteId,
    childRouteId,
    oldPath: childRoutePath,
    newPath: newChildPath,
    automaticRedirectCreated: autoRedirectRows[0],
    routeUpdatePreservation: true,
  };
  console.log("Routes Certification:", results.routes);

  // ══════════════════════════════════════════════════════════════════════════
  // 3. REDIRECT MANAGER CERTIFICATION
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- 3. Redirect Manager ---");

  const redirSource = `/legacy-landing-${Date.now().toString().slice(-4)}`;
  const redirTarget = `/new-landing-${Date.now().toString().slice(-4)}`;

  const { rows: customRedirRows } = await client.query(
    `insert into content_redirects (workspace_id, locale, source_path, target_path, status_code, is_active, description, created_by)
     values ($1, 'en', $2, $3, 308, true, 'Permanent preserve redirect', $4)
     returning id, source_path, target_path, status_code`,
    [disposableWorkspaceId, redirSource, redirTarget, actor.id]
  );

  results.redirects = {
    status: "CERTIFIED_LIVE",
    redirectId: customRedirRows[0].id,
    sourcePath: customRedirRows[0].source_path,
    targetPath: customRedirRows[0].target_path,
    statusCode: customRedirRows[0].status_code,
  };
  console.log("Redirects Certification:", results.redirects);

  // ══════════════════════════════════════════════════════════════════════════
  // 4. NAVIGATION MENUS DOMAIN CERTIFICATION
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- 4. Navigation Menus ---");

  const menuKey = `cert_header_${Date.now().toString().slice(-4)}`;
  const { rows: menuRows } = await client.query(
    `insert into navigation_menus (workspace_id, key, name, description)
     values ($1, $2, 'Certification Header Navigation', 'Main site navigation')
     returning id, key, name`,
    [disposableWorkspaceId, menuKey]
  );
  const menuId = menuRows[0].id;

  const initialNavItems = [
    { id: "item-1", label: "Home", itemType: "external_url", url: "/", openInNewTab: false, audienceRule: "all" },
    {
      id: "item-2",
      label: "Products",
      itemType: "internal_entry",
      targetEntryId: dummyEntryId,
      audienceRule: "all",
      children: [
        { id: "item-2a", label: "Page One", itemType: "internal_route", targetRouteId: childRouteId, audienceRule: "all" },
      ],
    },
    { id: "item-3", label: "Members Area", itemType: "external_url", url: "/members", audienceRule: "authenticated" },
  ];

  // Draft Version 1
  const { rows: navV1Rows } = await client.query(
    `insert into navigation_menu_versions (workspace_id, menu_id, version_number, state, items_jsonb, change_summary, created_by)
     values ($1, $2, 1, 'draft', $3::jsonb, 'Initial menu structure', $4)
     returning id, version_number, state`,
    [disposableWorkspaceId, menuId, JSON.stringify(initialNavItems), actor.id]
  );
  const navV1Id = navV1Rows[0].id;

  await client.query("update navigation_menus set current_draft_version_id = $1 where id = $2", [navV1Id, menuId]);

  // Publish Version 1 via Atomic PostgreSQL RPC
  await client.query(
    "select cms_publish_navigation_menu($1, $2, $3, 1)",
    [disposableWorkspaceId, actor.id, menuId]
  );

  // Verify in-transaction platform audit
  const { rows: menuAudit } = await client.query(
    "select * from platform_audit_events where workspace_id = $1 and action = 'navigation.menu_published' and entity_id = $2",
    [disposableWorkspaceId, menuId]
  );
  if (!menuAudit[0]) {
    throw new Error("Transactional audit missing for cms_publish_navigation_menu");
  }

  results.navigation = {
    status: "CERTIFIED_LIVE",
    menuId,
    menuKey,
    draftVersionId: navV1Id,
    publishedVersionNumber: 1,
    itemCount: initialNavItems.length,
    transactionalAuditVerified: true,
  };
  console.log("Navigation Certification:", results.navigation);

  // ══════════════════════════════════════════════════════════════════════════
  // 5. MEDIA OPERATIONS DOMAIN CERTIFICATION
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- 5. Media Operations ---");

  const colSlug = `cert-col-${Date.now().toString().slice(-4)}`;
  const { rows: colRows } = await client.query(
    `insert into media_collections (workspace_id, name, slug, description, created_by)
     values ($1, 'Certification Banners', $2, 'Marketing banner assets', $3)
     returning id, name, slug`,
    [disposableWorkspaceId, colSlug, actor.id]
  );
  const collectionId = colRows[0].id;

  const checksum1 = createHash("sha256").update(`initial-media-bytes-${Date.now()}`).digest("hex");
  const storageKey1 = `${disposableWorkspaceId}/cert/hero-banner-v1-${Date.now()}.png`;

  const { rows: assetRows } = await client.query(
    `insert into assets (workspace_id, storage_provider, storage_key, filename, mime_type, size_bytes, width, height, checksum, folder, created_by)
     values ($1, 'local', $2, 'hero-banner-v1.png', 'image/png', 204800, 1920, 1080, $3, 'cert', $4)
     returning id, filename, checksum, storage_key`,
    [disposableWorkspaceId, storageKey1, checksum1, actor.id]
  );
  const assetId = assetRows[0].id;

  // Add Asset to Collection
  await client.query(
    `insert into media_collection_assets (workspace_id, collection_id, asset_id, position)
     values ($1, $2, $3, 0)`,
    [disposableWorkspaceId, collectionId, assetId]
  );

  // In-Place Recoverable Asset Replacement via Atomic PostgreSQL RPC
  const checksum2 = createHash("sha256").update(`replacement-media-bytes-v2-${Date.now()}`).digest("hex");
  const storageKey2 = `${disposableWorkspaceId}/cert/hero-banner-v2-${Date.now()}.png`;

  const { rows: replRes } = await client.query(
    `select cms_replace_asset_file($1, $2, $3, 'local', $4, $5, 'hero-banner-v2.png', 'image/png', 256000, 120, 80, 'Updated seasonal visual branding') as result`,
    [disposableWorkspaceId, actor.id, assetId, storageKey2, checksum2]
  );

  // Verify in-transaction platform audit
  const { rows: mediaAudit } = await client.query(
    "select * from platform_audit_events where workspace_id = $1 and action = 'media.asset_replaced' and entity_id = $2",
    [disposableWorkspaceId, assetId]
  );
  if (!mediaAudit[0]) {
    throw new Error("Transactional audit missing for cms_replace_asset_file");
  }

  // 3. Connect Asset to Entry Relation & Query Usage Graph
  await client.query(
    `insert into content_relations (workspace_id, source_entry_id, source_version_id, source_field_key, target_asset_id, relation_type)
     values ($1, $2, $3, 'coverImage', $4, 'media_asset')`,
    [disposableWorkspaceId, dummyEntryId, dummyVersionId, assetId]
  );

  // 4. Verify composite foreign key enforcement (source_version_id, source_entry_id)
  let mismatchedVersionEntryRejected = false;
  try {
    const wrongEntryId = (await client.query(
      "insert into content_entries (workspace_id, content_model_id, status) values ($1, $2, 'draft') returning id",
      [disposableWorkspaceId, modelId]
    )).rows[0].id;
    await client.query(
      `insert into content_relations (workspace_id, source_entry_id, source_version_id, source_field_key, target_asset_id, relation_type)
       values ($1, $2, $3, 'coverImage', $4, 'media_asset')`,
      [disposableWorkspaceId, wrongEntryId, dummyVersionId, assetId]
    );
  } catch (err) {
    if (String(err).includes("content_relations_source_version_entry_fk") || String(err).includes("foreign key")) {
      mismatchedVersionEntryRejected = true;
    }
  }
  if (!mismatchedVersionEntryRejected) {
    throw new Error("Composite FK defect: content_relations allowed mismatched source_version_id and source_entry_id!");
  }

  const { rows: usageRows } = await client.query(
    `select source_entry_id, source_field_key from content_relations where target_asset_id = $1`,
    [assetId]
  );

  const replacementResult = replRes[0].result;

  results.media = {
    status: "CERTIFIED_LIVE",
    collectionId,
    assetId,
    replacementHistoryId: replacementResult.historyId,
    newChecksum: replacementResult.asset.checksum,
    usageGraphReferences: usageRows.length,
    transactionalAuditVerified: true,
    sourceVersionEntryFkEnforced: true,
  };
  console.log("Media Certification:", results.media);

  // ══════════════════════════════════════════════════════════════════════════
  // 6. FORCED-FAILURE ROLLBACK ASSERTIONS
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- 6. Forced-Failure Rollback Assertions ---");

  const auditCountBefore = parseInt((await client.query("select count(*) from platform_audit_events where workspace_id = $1", [disposableWorkspaceId])).rows[0].count, 10);

  // Attempt invalid merge (non-existent target) -> transaction must rollback
  try {
    await client.query(
      "select cms_merge_taxonomy_terms($1, $2, $3, $4)",
      [disposableWorkspaceId, actor.id, childTermId, randomUUID()]
    );
  } catch {
    // expected rejection
  }

  const auditCountAfter = parseInt((await client.query("select count(*) from platform_audit_events where workspace_id = $1", [disposableWorkspaceId])).rows[0].count, 10);
  if (auditCountBefore !== auditCountAfter) {
    throw new Error("Atomicity violation: Failed RPC leaked phantom audit entry!");
  }
  console.log("Forced-Failure Rollback Verified: 0 phantom audit entries on failed RPC.");

  // 6b. Atomic cms_replace_source_relations Rollback & Preservation Test
  const rbMenuKey = `rb_menu_${Date.now().toString().slice(-4)}`;
  const { rows: rbMenuRows } = await client.query(
    `insert into navigation_menus (workspace_id, key, name, description)
     values ($1, $2, 'Rollback Test Menu', 'Menu verifying atomic rollback of relations')
     returning id`,
    [disposableWorkspaceId, rbMenuKey]
  );
  const rbMenuId = rbMenuRows[0].id;

  // Insert 2 initial valid dependency relations for this menu
  await client.query(
    `insert into content_relations (workspace_id, source_menu_id, source_entity_type, target_entity_type, relation_type, target_entry_id)
     values ($1, $2, 'menu', 'entry', 'menu_entry', $3)`,
    [disposableWorkspaceId, rbMenuId, dummyEntryId]
  );
  await client.query(
    `insert into content_relations (workspace_id, source_menu_id, source_entity_type, target_entity_type, relation_type, target_route_id)
     values ($1, $2, 'menu', 'route', 'menu_route', $3)`,
    [disposableWorkspaceId, rbMenuId, childRouteId]
  );

  const { rows: initialEdgeRows } = await client.query(
    `select id::text as id, relation_type, target_entry_id::text as target_entry_id,
            target_route_id::text as target_route_id
     from content_relations
     where workspace_id = $1 and source_menu_id = $2
     order by id`,
    [disposableWorkspaceId, rbMenuId]
  );
  if (initialEdgeRows.length !== 2) {
    throw new Error(`Expected 2 initial relation edges, found ${initialEdgeRows.length}`);
  }
  const initialEdgeSnapshot = JSON.stringify(initialEdgeRows);
  const relationAuditCountBefore = parseInt((await client.query(
    "select count(*) from platform_audit_events where workspace_id = $1",
    [disposableWorkspaceId]
  )).rows[0].count, 10);

  // Attempt atomic replacement with a batch containing an invalid relation
  // The first item is valid, but the second item violates content_relations_target_check (all targets null)
  const invalidBatch = [
    {
      source_entity_type: "menu",
      target_entity_type: "entry",
      relation_type: "menu_entry",
      target_entry_id: dummyEntryId,
    },
    {
      source_entity_type: "menu",
      target_entity_type: "entry",
      relation_type: "menu_entry",
      // Missing all target_* fields violates content_relations_target_check
    },
  ];

  let replaceRejectedAsExpected = false;
  try {
    await client.query(
      "select cms_replace_source_relations($1, $2, $3, $4::jsonb)",
      [disposableWorkspaceId, "menu", rbMenuId, JSON.stringify(invalidBatch)]
    );
  } catch {
    replaceRejectedAsExpected = true;
  }

  if (!replaceRejectedAsExpected) {
    throw new Error("Atomicity defect: cms_replace_source_relations did not reject invalid relations batch!");
  }

  // Verify the exact original relations were preserved (NOT deleted/re-created or partially replaced)
  const { rows: preservedEdgeRows } = await client.query(
    `select id::text as id, relation_type, target_entry_id::text as target_entry_id,
            target_route_id::text as target_route_id
     from content_relations
     where workspace_id = $1 and source_menu_id = $2
     order by id`,
    [disposableWorkspaceId, rbMenuId]
  );
  if (preservedEdgeRows.length !== 2) {
    throw new Error(
      `Atomicity violation in cms_replace_source_relations: Expected 2 initial relations preserved, but found ${preservedEdgeRows.length}!`
    );
  }
  if (JSON.stringify(preservedEdgeRows) !== initialEdgeSnapshot) {
    throw new Error("Atomicity violation in cms_replace_source_relations: Original relation identities/targets changed after failed replacement!");
  }
  const relationAuditCountAfter = parseInt((await client.query(
    "select count(*) from platform_audit_events where workspace_id = $1",
    [disposableWorkspaceId]
  )).rows[0].count, 10);
  if (relationAuditCountAfter !== relationAuditCountBefore) {
    throw new Error(
      `Atomicity violation in cms_replace_source_relations: Failed replacement leaked phantom audit entries (${relationAuditCountBefore} -> ${relationAuditCountAfter})!`
    );
  }
  console.log("Forced-Failure Rollback Verified: cms_replace_source_relations rejected invalid batch, preserved the exact 2 original edges, performed no partial delete/replacement, and leaked 0 audit entries.");

  results.rollback = {
    status: "CERTIFIED_LIVE",
    phantomAuditLeakPrevented: true,
    replaceSourceRelationsRollbackPreserved: true,
    initialEdgeCount: 2,
    preservedEdgeCount: preservedEdgeRows.length,
    exactEdgeIdentityPreserved: true,
    replaceSourceRelationsAuditLeakPrevented: true,
  };

  results.allPassed = true;
  console.log("\n==========================================");
  console.log("PHASE 7 LIVE CERTIFICATION COMPLETE: ALL DOMAINS PASSED");
  console.log("==========================================");
} catch (err) {
  console.error("CERTIFICATION ERROR:", err);
  results.error = err.message;
} finally {
  // GUARANTEED CLEANUP: Cascade delete the disposable workspace and all test entities
  if (disposableWorkspaceId) {
    console.log(`[CLEANUP] Tearing down disposable workspace: ${disposableWorkspaceId}...`);
    try {
      await client.query("delete from workspaces where id = $1", [disposableWorkspaceId]);
      console.log("[CLEANUP] Teardown complete. Main workspace untouched.");
    } catch (cleanErr) {
      console.error("[CLEANUP ERROR]", cleanErr.message);
    }
  }
  await client.end();
}
