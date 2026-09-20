/**
 * Creates one idempotent, workspace-scoped fixture for the Phase 5 browser
 * certification. It deliberately does not touch Blog models or entries.
 *
 * Usage: node scripts/create-phase5-verification-fixture.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

for (const raw of readFileSync(".env.local", "utf8").split("\n")) {
  const match = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
}
const connectionString = process.env.Database_URL || process.env.DATABASE_URL || process.env.database_url;
if (!connectionString) throw new Error("Missing database connection string");

const schema = {
  name: "Phase 5 Verification Record",
  apiKey: "phase5_verification",
  description: "Isolated, reusable fixture for editorial collaboration and calendar certification.",
  capability: "content_enabled",
  fields: [{ key: "title", label: "Title", type: "short_text", required: true, localized: false, unique: false }],
};
const schemaHash = createHash("sha256").update(JSON.stringify(schema, Object.keys(schema).sort())).digest("hex");
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("BEGIN");
  const { rows: members } = await client.query(`
    select wm.workspace_id, wm.admin_user_id
    from workspace_members wm
    join admin_users au on au.id = wm.admin_user_id
    where wm.status = 'active'
    order by wm.created_at asc
    limit 1`);
  if (!members[0]) throw new Error("No active workspace member is available for the fixture");
  const { workspace_id: workspaceId, admin_user_id: actorId } = members[0];

  let { rows: models } = await client.query("select id from content_models where workspace_id = $1 and api_key = $2", [workspaceId, schema.apiKey]);
  let modelId = models[0]?.id;
  if (!modelId) {
    ({ rows: models } = await client.query(`insert into content_models (workspace_id, name, api_key, description, status, current_schema_version, settings_json, created_by)
      values ($1, $2, $3, $4, 'active', 1, $5::jsonb, $6) returning id`, [workspaceId, schema.name, schema.apiKey, schema.description, JSON.stringify({ capability: schema.capability }), actorId]));
    modelId = models[0].id;
    await client.query(`insert into content_model_versions (content_model_id, version_number, schema_json, schema_hash, change_summary, created_by)
      values ($1, 1, $2::jsonb, $3, 'Phase 5 browser verification fixture', $4)`, [modelId, JSON.stringify(schema), schemaHash, actorId]);
    await client.query(`insert into content_fields (content_model_id, field_key, label, field_type, position, configuration_json)
      values ($1, 'title', 'Title', 'short_text', 0, $2::jsonb)`, [modelId, JSON.stringify({ required: true, localized: false, unique: false })]);
  }

  const fixtureTitle = "Phase 5 editorial verification fixture";
  let { rows: entries } = await client.query(`select ce.id from content_entries ce
    join content_entry_versions cev on cev.id = ce.current_draft_version_id
    where ce.workspace_id = $1 and ce.content_model_id = $2 and cev.data_jsonb ->> 'title' = $3 limit 1`, [workspaceId, modelId, fixtureTitle]);
  let entryId = entries[0]?.id;
  if (!entryId) {
    ({ rows: entries } = await client.query(`insert into content_entries (workspace_id, content_model_id, status, created_by, updated_by)
      values ($1, $2, 'draft', $3, $3) returning id`, [workspaceId, modelId, actorId]));
    entryId = entries[0].id;
    const { rows: versions } = await client.query(`insert into content_entry_versions (entry_id, model_schema_version, version_number, data_jsonb, locale, state, created_by, change_summary)
      values ($1, 1, 1, $2::jsonb, 'en', 'draft', $3, 'Phase 5 browser verification fixture') returning id`, [entryId, JSON.stringify({ title: fixtureTitle }), actorId]);
    await client.query("update content_entries set current_draft_version_id = $1 where id = $2", [versions[0].id, entryId]);
  }
  const { rows: currentVersions } = await client.query("select current_draft_version_id from content_entries where id = $1", [entryId]);
  await client.query(`insert into content_search_documents (entry_id, workspace_id, version_id, content_model_id, locale, status, author_id, search_text, updated_at)
    values ($1, $2, $3, $4, 'en', 'draft', $5, $6, now())
    on conflict (entry_id) do update set version_id = excluded.version_id, status = excluded.status, search_text = excluded.search_text, updated_at = excluded.updated_at`,
    [entryId, workspaceId, currentVersions[0].current_draft_version_id, modelId, actorId, fixtureTitle]);
  await client.query(`insert into platform_audit_events (workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json)
    values ($1, $2, 'phase5.verification_fixture.ready', 'content_entry', $3, $4::jsonb)`, [workspaceId, actorId, entryId, JSON.stringify({ modelApiKey: schema.apiKey, purpose: "authenticated browser certification" })]);
  await client.query("COMMIT");
  console.log(JSON.stringify({ ok: true, workspaceId, modelId, entryId, fixtureTitle }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
