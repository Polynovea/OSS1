// Read-only live proof for Phase 3's additive saved-view migration.
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

for (const line of readFileSync(path.resolve(".env.local"), "utf8").split("\n")) {
  const [key, ...rest] = line.trim().split("=");
  if (key && rest.length && !process.env[key]) process.env[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
}
const connectionString = process.env.Database_URL || process.env.DATABASE_URL || process.env.database_url;
if (!connectionString) throw new Error("Database_URL is required");
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const table = await client.query("select relrowsecurity from pg_class where oid = 'public.content_entry_saved_views'::regclass");
  const indexes = await client.query("select indexname from pg_indexes where schemaname = 'public' and tablename = 'content_entry_saved_views' order by indexname");
  const required = ["content_entry_saved_views_workspace_owner_idx", "content_entry_saved_views_workspace_model_idx"];
  if (table.rows[0]?.relrowsecurity !== true) throw new Error("RLS is not enabled on content_entry_saved_views");
  const actual = new Set(indexes.rows.map((row) => row.indexname));
  for (const index of required) if (!actual.has(index)) throw new Error(`Missing index: ${index}`);
  console.log(JSON.stringify({ ok: true, table: "content_entry_saved_views", rls: true, indexes: required }, null, 2));
} finally { await client.end(); }
