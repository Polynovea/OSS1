/**
 * Creates idempotent Customer and Project models plus one related record of
 * each, exclusively for Phase 2's non-engineer end-to-end certification.
 * It never touches legacy Blog data.
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

const customerSchema = {
  name: "Phase 2 Customer", apiKey: "phase2_customer", capability: "data_only",
  description: "Isolated Customer model used to certify the Visual Database Studio.",
  fields: [
    { key: "name", label: "Customer name", type: "text", required: true, localized: false, unique: true, index: true, uiHints: { helpText: "Use the legal or trading name." } },
    { key: "status", label: "Status", type: "select", required: true, localized: false, unique: false, defaultValue: "active", validation: { options: ["lead", "active", "inactive"] } },
  ],
};
const projectSchema = {
  name: "Phase 2 Project", apiKey: "phase2_project", capability: "data_only",
  description: "Isolated Project model linked to the Phase 2 Customer fixture.",
  fields: [
    { key: "title", label: "Project title", type: "text", required: true, localized: false, unique: false, index: true },
    { key: "customer", label: "Customer", type: "relation", required: true, localized: false, unique: false, relation: { targetModelApiKey: "phase2_customer", cardinality: "many_to_one", onDelete: "block" } },
    { key: "status", label: "Status", type: "select", required: true, localized: false, unique: false, defaultValue: "planned", validation: { options: ["planned", "active", "complete"] } },
  ],
};
const hash = (schema) => createHash("sha256").update(JSON.stringify(schema, Object.keys(schema).sort())).digest("hex");
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

async function ensureModel(workspaceId, actorId, schema) {
  const existing = await client.query("select id from content_models where workspace_id = $1 and api_key = $2", [workspaceId, schema.apiKey]);
  if (existing.rows[0]) return existing.rows[0].id;
  const model = await client.query(`insert into content_models (workspace_id, name, api_key, description, status, current_schema_version, settings_json, created_by)
    values ($1, $2, $3, $4, 'active', 1, $5::jsonb, $6) returning id`, [workspaceId, schema.name, schema.apiKey, schema.description, JSON.stringify({ capability: schema.capability }), actorId]);
  const modelId = model.rows[0].id;
  await client.query(`insert into content_model_versions (content_model_id, version_number, schema_json, schema_hash, change_summary, created_by)
    values ($1, 1, $2::jsonb, $3, 'Phase 2 end-to-end fixture', $4)`, [modelId, JSON.stringify(schema), hash(schema), actorId]);
  await client.query(`insert into content_fields (content_model_id, field_key, label, field_type, position, configuration_json)
    select $1, item->>'key', item->>'label', item->>'type', ordinality - 1, item - 'key' - 'label' - 'type'
    from jsonb_array_elements($2::jsonb) with ordinality as values(item, ordinality)`, [modelId, JSON.stringify(schema.fields)]);
  return modelId;
}

async function ensureEntry(workspaceId, actorId, modelId, title, data) {
  const existing = await client.query(`select ce.id from content_entries ce join content_entry_versions cev on cev.id = ce.current_draft_version_id
    where ce.workspace_id = $1 and ce.content_model_id = $2 and cev.data_jsonb ->> $3 = $4 limit 1`, [workspaceId, modelId, title.key, title.value]);
  let entryId = existing.rows[0]?.id;
  if (!entryId) {
    const entry = await client.query(`insert into content_entries (workspace_id, content_model_id, status, created_by, updated_by)
      values ($1, $2, 'draft', $3, $3) returning id`, [workspaceId, modelId, actorId]);
    entryId = entry.rows[0].id;
    const version = await client.query(`insert into content_entry_versions (entry_id, model_schema_version, version_number, data_jsonb, locale, state, created_by, change_summary)
      values ($1, 1, 1, $2::jsonb, 'en', 'draft', $3, 'Phase 2 end-to-end fixture') returning id`, [entryId, JSON.stringify(data), actorId]);
    await client.query("update content_entries set current_draft_version_id = $1 where id = $2", [version.rows[0].id, entryId]);
  }
  const version = await client.query("select current_draft_version_id from content_entries where id = $1", [entryId]);
  await client.query(`insert into content_search_documents (entry_id, workspace_id, version_id, content_model_id, locale, status, author_id, search_text, updated_at)
    values ($1, $2, $3, $4, 'en', 'draft', $5, $6, now())
    on conflict (entry_id) do update set version_id = excluded.version_id, search_text = excluded.search_text, updated_at = excluded.updated_at`,
    [entryId, workspaceId, version.rows[0].current_draft_version_id, modelId, actorId, Object.values(data).filter((value) => typeof value === "string").join(" ")]);
  return entryId;
}

await client.connect();
try {
  await client.query("BEGIN");
  const members = await client.query(`select workspace_id, admin_user_id from workspace_members where status = 'active' order by created_at asc limit 1`);
  if (!members.rows[0]) throw new Error("No active workspace member is available for the fixture");
  const { workspace_id: workspaceId, admin_user_id: actorId } = members.rows[0];
  const customerModelId = await ensureModel(workspaceId, actorId, customerSchema);
  const projectModelId = await ensureModel(workspaceId, actorId, projectSchema);
  const customerEntryId = await ensureEntry(workspaceId, actorId, customerModelId, { key: "name", value: "Phase 2 verification customer" }, { name: "Phase 2 verification customer", status: "active" });
  const projectEntryId = await ensureEntry(workspaceId, actorId, projectModelId, { key: "title", value: "Phase 2 verification project" }, { title: "Phase 2 verification project", customer: customerEntryId, status: "planned" });
  const projectVersion = await client.query("select current_draft_version_id from content_entries where id = $1", [projectEntryId]);
  // Relation values have a searchable, dependency-safe projection as well as
  // their canonical version payload. Limit the replacement to this isolated
  // fixture field so repeated runs remain idempotent.
  await client.query("delete from content_relations where source_entry_id = $1 and source_field_key = 'customer'", [projectEntryId]);
  await client.query(`insert into content_relations (workspace_id, source_entry_id, source_version_id, source_field_key, target_entry_id, relation_type)
    values ($1, $2, $3, 'customer', $4, 'reference')`, [workspaceId, projectEntryId, projectVersion.rows[0].current_draft_version_id, customerEntryId]);
  await client.query(`insert into platform_audit_events (workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json)
    values ($1, $2, 'phase2.verification_fixture.ready', 'content_entry', $3, $4::jsonb)`, [workspaceId, actorId, projectEntryId, JSON.stringify({ customerModelId, projectModelId, customerEntryId, purpose: "Phase 2 browser certification" })]);
  await client.query("COMMIT");
  console.log(JSON.stringify({ ok: true, workspaceId, customerModelId, projectModelId, customerEntryId, projectEntryId }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
