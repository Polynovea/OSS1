/** Read-only database evidence for Phase 2's Customer → Project fixture. */
import { readFileSync } from "node:fs";
import pg from "pg";

for (const raw of readFileSync(".env.local", "utf8").split("\n")) {
  const match = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
}
const connectionString = process.env.Database_URL || process.env.DATABASE_URL || process.env.database_url;
if (!connectionString) throw new Error("Missing database connection string");
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows: models } = await client.query(`select m.api_key, m.current_schema_version, v.schema_json
    from content_models m join content_model_versions v on v.content_model_id = m.id and v.version_number = m.current_schema_version
    where m.api_key in ('phase2_customer', 'phase2_project') order by m.api_key`);
  const { rows: relation } = await client.query(`select cr.source_field_key, source_model.api_key as source_model, target_model.api_key as target_model
    from content_relations cr
    join content_entries source_entry on source_entry.id = cr.source_entry_id
    join content_models source_model on source_model.id = source_entry.content_model_id
    join content_entries target_entry on target_entry.id = cr.target_entry_id
    join content_models target_model on target_model.id = target_entry.content_model_id
    where source_model.api_key = 'phase2_project' and target_model.api_key = 'phase2_customer' and cr.source_field_key = 'customer'`);
  const { rows: rls } = await client.query(`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and relname = any($1::text[])`, [["content_models", "content_model_versions", "content_fields", "content_entries", "content_entry_versions", "content_relations"]]);
  const modelKeys = models.map((model) => model.api_key);
  const ok = modelKeys.includes("phase2_customer") && modelKeys.includes("phase2_project") && relation.length === 1 && rls.length === 6 && rls.every((table) => table.relrowsecurity);
  console.log(JSON.stringify({ ok, models: models.map(({ api_key, current_schema_version, schema_json }) => ({ apiKey: api_key, version: current_schema_version, capability: schema_json.capability, fieldCount: schema_json.fields.length })), relation, rls }));
  if (!ok) process.exitCode = 1;
} finally {
  await client.end();
}
