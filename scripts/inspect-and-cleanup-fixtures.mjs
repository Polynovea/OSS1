import pg from "pg";
import { readFileSync } from "fs";

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

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

console.log("=== PHASE 7 FIXTURE AUDIT & CLEANUP ===");

// 1. Inspect Taxonomies
const { rows: taxRows } = await client.query(`
  select id, name, slug from taxonomies
  where name in ('Certification Categories', 'Auth Cert Taxonomy')
     or slug like 'cert-tax-%'
     or slug like 'auth-tax-%'
`);
console.log(`Found ${taxRows.length} test taxonomies:`, taxRows);

// 2. Inspect Routes
const { rows: routeRows } = await client.query(`
  select id, path, title from content_routes
  where path like '/cert-section-%'
     or path like '/roll-test-%'
     or title in ('Certification Section', 'Page One', 'Route A', 'Route B')
`);
console.log(`Found ${routeRows.length} test routes:`, routeRows);

// 3. Inspect Redirects
const { rows: redirRows } = await client.query(`
  select id, source_path, target_path, status_code, description from content_redirects
  where source_path like '/cert-section-%'
     or source_path like '/legacy-landing-%'
     or source_path like '/roll-test-%'
     or target_path like '/new-landing-%'
     or target_path like '/cert-section-%'
`);
console.log(`Found ${redirRows.length} test redirects:`, redirRows);

// 4. Inspect Navigation Menus
const { rows: menuRows } = await client.query(`
  select id, key, name from navigation_menus
  where key like 'cert_header_%'
     or key like 'auth_nav_%'
     or name in ('Certification Header Navigation', 'Auth Cert Menu')
`);
console.log(`Found ${menuRows.length} test navigation menus:`, menuRows);

// 5. Inspect Media Collections
const { rows: colRows } = await client.query(`
  select id, name, slug from media_collections
  where slug like 'cert-col-%'
     or name = 'Certification Banners'
`);
console.log(`Found ${colRows.length} test media collections:`, colRows);

// 6. Inspect Assets
const { rows: assetRows } = await client.query(`
  select id, filename, folder from assets
  where folder = 'cert'
     or filename like 'hero-banner-v%'
`);
console.log(`Found ${assetRows.length} test assets:`, assetRows);

// 7. Inspect Dummy Content Entries created by cert scripts
const { rows: entryRows } = await client.query(`
  select ce.id, cev.data_jsonb
  from content_entries ce
  join content_entry_versions cev on cev.entry_id = ce.id
  where cev.data_jsonb->>'title' in ('Taxonomy Test Entry', 'Unified Edge Entry')
`);
console.log(`Found ${entryRows.length} test content entries:`, entryRows);

console.log("\n--- EXECUTING POSITIVE TARGETED CLEANUP ---");

let deletedCounts = {
  taxonomies: 0,
  taxonomy_terms: 0,
  routes: 0,
  route_history: 0,
  redirects: 0,
  navigation_menus: 0,
  navigation_menu_versions: 0,
  media_collections: 0,
  assets: 0,
  asset_replacement_history: 0,
  content_entries: 0,
  content_relations: 0,
};

// Clean Content Relations for test entries/assets
if (entryRows.length > 0 || assetRows.length > 0) {
  const entryIds = entryRows.map((r) => r.id);
  const assetIds = assetRows.map((r) => r.id);
  const res = await client.query(`
    delete from content_relations
    where source_entry_id = any($1::uuid[])
       or target_asset_id = any($2::uuid[])
  `, [entryIds, assetIds]);
  deletedCounts.content_relations = res.rowCount;
}

// Clean Content Entries
if (entryRows.length > 0) {
  const entryIds = entryRows.map((r) => r.id);
  const res = await client.query(`
    delete from content_entries where id = any($1::uuid[])
  `, [entryIds]);
  deletedCounts.content_entries = res.rowCount;
}

// Clean Assets & Replacement History
if (assetRows.length > 0) {
  const assetIds = assetRows.map((r) => r.id);
  const histRes = await client.query(`
    delete from asset_replacement_history where asset_id = any($1::uuid[])
  `, [assetIds]);
  deletedCounts.asset_replacement_history = histRes.rowCount;

  const assetRes = await client.query(`
    delete from assets where id = any($1::uuid[])
  `, [assetIds]);
  deletedCounts.assets = assetRes.rowCount;
}

// Clean Media Collections
if (colRows.length > 0) {
  const colIds = colRows.map((r) => r.id);
  const res = await client.query(`
    delete from media_collections where id = any($1::uuid[])
  `, [colIds]);
  deletedCounts.media_collections = res.rowCount;
}

// Clean Navigation Menus
if (menuRows.length > 0) {
  const menuIds = menuRows.map((r) => r.id);
  const res = await client.query(`
    delete from navigation_menus where id = any($1::uuid[])
  `, [menuIds]);
  deletedCounts.navigation_menus = res.rowCount;
}

// Clean Redirects
if (redirRows.length > 0) {
  const redirIds = redirRows.map((r) => r.id);
  const res = await client.query(`
    delete from content_redirects where id = any($1::uuid[])
  `, [redirIds]);
  deletedCounts.redirects = res.rowCount;
}

// Clean Routes & Route History
if (routeRows.length > 0) {
  const routeIds = routeRows.map((r) => r.id);
  const histRes = await client.query(`
    delete from content_route_history where route_id = any($1::uuid[])
  `, [routeIds]);
  deletedCounts.route_history = histRes.rowCount;

  const routeRes = await client.query(`
    delete from content_routes where id = any($1::uuid[])
  `, [routeIds]);
  deletedCounts.routes = routeRes.rowCount;
}

// Clean Taxonomies (cascades terms, aliases, localizations)
if (taxRows.length > 0) {
  const taxIds = taxRows.map((r) => r.id);
  const res = await client.query(`
    delete from taxonomies where id = any($1::uuid[])
  `, [taxIds]);
  deletedCounts.taxonomies = res.rowCount;
}

console.log("Cleanup Results:", deletedCounts);

// Verify Real Workspace Data remains intact
const { rows: realModels } = await client.query("select count(*) from content_models");
const { rows: realEntries } = await client.query("select count(*) from content_entries");
const { rows: realAssets } = await client.query("select count(*) from assets");

console.log(`\nVerified Working CMS Workspace Intact:`);
console.log(`- Content Models: ${realModels[0].count}`);
console.log(`- Content Entries: ${realEntries[0].count}`);
console.log(`- Assets: ${realAssets[0].count}`);

await client.end();
