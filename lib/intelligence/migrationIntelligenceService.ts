import { randomUUID } from "node:crypto";
import pg from "pg";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { redactCredentials, resolveConnectionCredentials } from "@/lib/infrastructure/credentialProvider";
import { computeSchemaHash, getModel, getVersion } from "@/lib/schema/modelService";
import { validateCanonicalSchema } from "@/lib/schema/canonicalSchema";
import { computeSchemaDiff } from "@/lib/schema/diff";
import type { FieldDefinition } from "@/lib/schema/fields/types";
import type { FieldDiffEntry, SchemaDiff } from "@/lib/schema/diff";
import type { OperationalDeterministicClassification } from "@/lib/intelligence/operationalTypes";
import { logPlatformEvent } from "@/lib/platform/audit";

const { Client } = pg;

export interface FieldDataProfile {
  fieldKey: string;
  changeKind: FieldDiffEntry["kind"];
  schemaClassification: FieldDiffEntry["classification"];
  populatedCount: number;
  missingOrNullCount: number;
  duplicateGroupCount: number;
  duplicateEntryCount: number;
  incompatibleTypeCount: number | null;
  validationViolationCount: number;
  relationViolationCount: number;
  checks: Array<{ key: string; status: "passed" | "warning" | "failed" | "not_applicable"; count?: number; note: string }>;
}

export interface DataAwareChangeAssessment {
  model: { id: string; apiKey: string; currentVersion: number };
  target: { provider: string; connectionId: string; database: string | null; ssl: boolean | null };
  schemaDiff: SchemaDiff;
  dataProfile: {
    entryCount: number;
    versionCount: number;
    activeRelationCount: number;
    tableBytes: number;
    tableSizeHuman: string;
    ungrantedLockCount: number;
    exclusiveLockCount: number;
    coreIndexesReady: boolean;
    fields: FieldDataProfile[];
  };
  deterministicClassification: OperationalDeterministicClassification;
  hardBlockers: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
  alternatives: Array<Record<string, unknown>>;
  estimate: Record<string, unknown>;
}

function toInt(value: unknown) { return Number(value ?? 0) || 0; }

async function findDatabaseConnection(workspaceId: string, environmentId: string) {
  const db = createServiceRoleClient();
  const { data, error } = await db.from("workspace_connections")
    .select("id,connector_type,name,status,active,created_at")
    .eq("workspace_id", workspaceId)
    .eq("environment_id", environmentId)
    .eq("connector_family", "database")
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const connection = (data ?? []).find((row) => ["database.postgres", "database.supabase"].includes(row.connector_type) && row.status === "active") ?? null;
  if (!connection) throw Object.assign(new Error("No active PostgreSQL/Supabase database connection is available for data-aware migration inspection"), { status: 409 });
  const credentials = await resolveConnectionCredentials(workspaceId, connection.id);
  const connectionString = credentials.connection_url ?? null;
  if (!connectionString) throw Object.assign(new Error("The active database connection does not expose a direct PostgreSQL connection URL for read-only data inspection"), { status: 409 });
  return { connection, connectionString, credentials };
}

async function connect(connectionString: string) {
  const url = new URL(connectionString);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const client = new Client({ connectionString, ssl: local ? undefined : { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000, statement_timeout: 20_000, query_timeout: 20_000 });
  await client.connect();
  await client.query("set default_transaction_read_only = on");
  return client;
}

function expectedJsonKinds(field: FieldDefinition): string[] | null {
  if (["text", "long_text", "rich_text", "markdown", "slug", "email", "url", "select", "date", "datetime"].includes(field.type)) return ["string"];
  if (["number", "integer"].includes(field.type)) return ["number"];
  if (field.type === "boolean") return ["boolean"];
  if (field.type === "multi_select" || field.type === "repeater") return ["array"];
  if (field.type === "component") return ["object"];
  if (field.type === "json") return ["object", "array", "string", "number", "boolean", "null"];
  // Relation/media/file may be represented by a projected ID, array, or object depending on editor semantics.
  return null;
}

async function scalarCount(client: pg.Client, sql: string, values: unknown[]) {
  const result = await client.query(sql, values);
  return toInt(result.rows[0]?.count);
}

async function profileField(params: {
  client: pg.Client;
  workspaceId: string;
  modelId: string;
  diff: FieldDiffEntry;
}): Promise<FieldDataProfile> {
  const { client, workspaceId, modelId, diff } = params;
  const fieldKey = diff.fieldKey;
  if (fieldKey === "__capability__") {
    return { fieldKey, changeKind: diff.kind, schemaClassification: diff.classification, populatedCount: 0, missingOrNullCount: 0, duplicateGroupCount: 0, duplicateEntryCount: 0, incompatibleTypeCount: null, validationViolationCount: 0, relationViolationCount: 0, checks: [{ key: "capability", status: "not_applicable", note: "Capability changes affect workflow/publication reachability rather than one JSON field." }] };
  }

  const baseFrom = `from public.content_entries e left join public.content_entry_versions v on v.id=coalesce(e.current_draft_version_id,e.published_version_id) where e.workspace_id=$1 and e.content_model_id=$2 and e.archived_at is null`;
  const populatedCount = await scalarCount(client, `select count(*)::bigint as count ${baseFrom} and v.id is not null and v.data_jsonb ? $3 and v.data_jsonb->$3 is not null and jsonb_typeof(v.data_jsonb->$3) <> 'null'`, [workspaceId, modelId, fieldKey]);
  const missingOrNullCount = await scalarCount(client, `select count(*)::bigint as count ${baseFrom} and (v.id is null or not (v.data_jsonb ? $3) or v.data_jsonb->$3 is null or jsonb_typeof(v.data_jsonb->$3)='null' or (jsonb_typeof(v.data_jsonb->$3)='string' and btrim(v.data_jsonb->>$3)=''))`, [workspaceId, modelId, fieldKey]);
  const checks: FieldDataProfile["checks"] = [];
  let duplicateGroupCount = 0;
  let duplicateEntryCount = 0;
  let incompatibleTypeCount: number | null = null;
  let validationViolationCount = 0;
  let relationViolationCount = 0;
  const target = diff.after;

  if (diff.kind === "removed") {
    checks.push({ key: "removed_field_population", status: populatedCount ? "failed" : "passed", count: populatedCount, note: populatedCount ? "Existing current records still contain this field; direct removal would orphan meaningful data." : "No current record contains a populated value for the removed field." });
  }

  if (target?.required) {
    checks.push({ key: "required", status: missingOrNullCount ? "failed" : "passed", count: missingOrNullCount, note: missingOrNullCount ? "Records require backfill before this field can be treated as required." : "All current records have a non-null value." });
  }

  if (target?.unique) {
    const duplicate = await client.query(`with values as (
      select v.data_jsonb->$3 as value
      ${baseFrom}
        and v.id is not null and v.data_jsonb ? $3 and v.data_jsonb->$3 is not null and jsonb_typeof(v.data_jsonb->$3)<>'null'
    ), groups as (
      select value,count(*)::bigint as n from values group by value having count(*)>1
    ) select count(*)::bigint as group_count,coalesce(sum(n),0)::bigint as entry_count from groups`, [workspaceId, modelId, fieldKey]);
    duplicateGroupCount = toInt(duplicate.rows[0]?.group_count);
    duplicateEntryCount = toInt(duplicate.rows[0]?.entry_count);
    checks.push({ key: "unique", status: duplicateGroupCount ? "failed" : "passed", count: duplicateEntryCount, note: duplicateGroupCount ? `${duplicateGroupCount} duplicate value group(s) affect ${duplicateEntryCount} records; direct uniqueness enforcement is blocked.` : "No duplicate populated values detected." });
  }

  if (target && diff.before?.type !== target.type) {
    const expected = expectedJsonKinds(target);
    if (expected) {
      incompatibleTypeCount = await scalarCount(client, `select count(*)::bigint as count ${baseFrom} and v.id is not null and v.data_jsonb ? $3 and v.data_jsonb->$3 is not null and jsonb_typeof(v.data_jsonb->$3)<>'null' and not (jsonb_typeof(v.data_jsonb->$3)=any($4::text[]))`, [workspaceId, modelId, fieldKey, expected]);
      checks.push({ key: "type_compatibility", status: incompatibleTypeCount ? "failed" : "passed", count: incompatibleTypeCount, note: incompatibleTypeCount ? "Existing JSON value shapes are incompatible with the proposed field type; an explicit transform is required." : "Existing JSON value shapes are structurally compatible with the proposed type." });
    } else {
      checks.push({ key: "type_compatibility", status: "warning", note: "This field type has polymorphic storage semantics; conversion must be reviewed by a specialized deterministic transform rather than guessed." });
    }
  }

  if (target?.validation?.maxLength !== undefined) {
    const count = await scalarCount(client, `select count(*)::bigint as count ${baseFrom} and jsonb_typeof(v.data_jsonb->$3)='string' and char_length(v.data_jsonb->>$3)>$4`, [workspaceId, modelId, fieldKey, target.validation.maxLength]);
    validationViolationCount += count;
    checks.push({ key: "max_length", status: count ? "failed" : "passed", count, note: count ? "Existing values exceed the proposed maxLength." : "No current string value exceeds maxLength." });
  }
  if (target?.validation?.minLength !== undefined) {
    const count = await scalarCount(client, `select count(*)::bigint as count ${baseFrom} and jsonb_typeof(v.data_jsonb->$3)='string' and char_length(v.data_jsonb->>$3)<$4`, [workspaceId, modelId, fieldKey, target.validation.minLength]);
    validationViolationCount += count;
    checks.push({ key: "min_length", status: count ? "failed" : "passed", count, note: count ? "Existing values are shorter than the proposed minLength." : "No current string value violates minLength." });
  }
  if (target?.validation?.min !== undefined) {
    const count = await scalarCount(client, `select count(*)::bigint as count ${baseFrom} and jsonb_typeof(v.data_jsonb->$3)='number' and (v.data_jsonb->>$3)::numeric<$4`, [workspaceId, modelId, fieldKey, target.validation.min]);
    validationViolationCount += count;
    checks.push({ key: "min", status: count ? "failed" : "passed", count, note: count ? "Existing numeric values are below the proposed minimum." : "No current numeric value violates the minimum." });
  }
  if (target?.validation?.max !== undefined) {
    const count = await scalarCount(client, `select count(*)::bigint as count ${baseFrom} and jsonb_typeof(v.data_jsonb->$3)='number' and (v.data_jsonb->>$3)::numeric>$4`, [workspaceId, modelId, fieldKey, target.validation.max]);
    validationViolationCount += count;
    checks.push({ key: "max", status: count ? "failed" : "passed", count, note: count ? "Existing numeric values exceed the proposed maximum." : "No current numeric value violates the maximum." });
  }
  if (target?.validation?.options?.length && target.type === "select") {
    const count = await scalarCount(client, `select count(*)::bigint as count ${baseFrom} and jsonb_typeof(v.data_jsonb->$3)='string' and not ((v.data_jsonb->>$3)=any($4::text[]))`, [workspaceId, modelId, fieldKey, target.validation.options]);
    validationViolationCount += count;
    checks.push({ key: "options", status: count ? "failed" : "passed", count, note: count ? "Existing select values are outside the proposed option set." : "All current select values are allowed by the proposed options." });
  }
  if (target?.validation?.options?.length && target.type === "multi_select") {
    const result = await client.query(`select count(distinct e.id)::bigint as count ${baseFrom} and jsonb_typeof(v.data_jsonb->$3)='array' and exists(select 1 from jsonb_array_elements_text(v.data_jsonb->$3) item where not (item=any($4::text[])))`, [workspaceId, modelId, fieldKey, target.validation.options]);
    const count = toInt(result.rows[0]?.count);
    validationViolationCount += count;
    checks.push({ key: "options", status: count ? "failed" : "passed", count, note: count ? "Existing multi-select records contain options that are no longer allowed." : "All current multi-select values are allowed." });
  }
  if (target?.validation?.pattern) {
    checks.push({ key: "pattern", status: "warning", note: "User-authored regex is not executed inside the database inspection boundary; application-level validation must certify existing values before direct enforcement." });
  }

  if (target?.type === "relation" && target.relation?.targetModelApiKey) {
    const relation = await client.query(`select count(*)::bigint as count
      from public.content_relations r
      join public.content_entries source on source.id=r.source_entry_id
      left join public.content_entries target on target.id=r.target_entry_id
      left join public.content_models tm on tm.id=target.content_model_id
      where source.workspace_id=$1 and source.content_model_id=$2 and source.archived_at is null
        and r.source_version_id=coalesce(source.current_draft_version_id,source.published_version_id)
        and r.source_field_key=$3 and r.target_entry_id is not null
        and (target.id is null or target.workspace_id<>$1 or tm.api_key<>$4)`, [workspaceId, modelId, fieldKey, target.relation.targetModelApiKey]);
    relationViolationCount = toInt(relation.rows[0]?.count);
    checks.push({ key: "relation_target", status: relationViolationCount ? "failed" : "passed", count: relationViolationCount, note: relationViolationCount ? "Current relation edges do not satisfy the proposed target-model boundary." : "Current relation edges satisfy the proposed target-model boundary." });
  }

  return { fieldKey, changeKind: diff.kind, schemaClassification: diff.classification, populatedCount, missingOrNullCount, duplicateGroupCount, duplicateEntryCount, incompatibleTypeCount, validationViolationCount, relationViolationCount, checks };
}

function classifyAssessment(schemaClassification: string, fields: FieldDataProfile[], ungrantedLocks: number): OperationalDeterministicClassification {
  const populatedRemoval = fields.some((field) => field.changeKind === "removed" && field.populatedCount > 0);
  if (populatedRemoval || schemaClassification === "DESTRUCTIVE") return "destructive";
  if (fields.some((field) => (field.incompatibleTypeCount ?? 0) > 0 || field.duplicateEntryCount > 0 || field.relationViolationCount > 0)) return "requires_data_migration";
  if (fields.some((field) => field.missingOrNullCount > 0 && field.checks.some((check) => check.key === "required" && check.status === "failed"))) return "requires_backfill";
  if (fields.some((field) => field.validationViolationCount > 0) || schemaClassification === "REQUIRES_DATA_MIGRATION") return "requires_data_migration";
  if (ungrantedLocks > 0) return "requires_lock";
  if (schemaClassification === "POTENTIALLY_DESTRUCTIVE") return "potentially_destructive";
  return "safe";
}

function buildAlternatives(classification: OperationalDeterministicClassification, fields: FieldDataProfile[], entryCount: number) {
  const alternatives: Array<Record<string, unknown>> = [];
  if (classification === "safe") alternatives.push({ key: "direct_metadata_change", title: "Direct governed schema revision", classification: "safe", steps: ["apply schema revision", "verify generated validation/API metadata", "rediscover and reconcile"] });
  if (fields.some((field) => field.checks.some((check) => check.key === "required" && check.status === "failed"))) alternatives.push({ key: "staged_backfill", title: "Stage → backfill → enforce", classification: "requires_backfill", steps: ["keep field nullable/optional", "backfill missing records in bounded batches", "verify zero missing values", "activate required constraint in canonical schema"] });
  if (fields.some((field) => field.duplicateEntryCount > 0)) alternatives.push({ key: "deduplicate_then_unique", title: "Resolve duplicates before uniqueness", classification: "requires_data_migration", steps: ["export duplicate identities without secret values", "resolve collision policy", "apply deterministic record changes", "verify zero duplicate groups", "enable uniqueness semantics"] });
  if (fields.some((field) => (field.incompatibleTypeCount ?? 0) > 0)) alternatives.push({ key: "copy_transform_verify", title: "Copy → transform → verify → switch", classification: "requires_data_migration", steps: ["create transformation mapping", "dry-run conversion", "write transformed values in bounded batches", "verify structural/type validity", "activate new schema version"] });
  if (fields.some((field) => field.changeKind === "removed" && field.populatedCount > 0)) {
    alternatives.push({ key: "deprecate_retain", title: "Deprecate and retain data", classification: "safe", steps: ["hide/deprecate field in authoring UI", "retain historical/current payload", "remove only after retention/export decision"] });
    alternatives.push({ key: "explicit_destructive_removal", title: "Explicit destructive removal", classification: "destructive", steps: ["create verified backup/export", "obtain high-risk approval", "apply reviewed data migration", "verify evidence package"] });
  }
  if (!alternatives.length) alternatives.push({ key: "review_only", title: "Review before execution", classification, steps: ["review aggregate target-data evidence", "select a deterministic migration strategy", "simulate", "execute under policy"] });
  return alternatives.map((alternative) => ({ ...alternative, estimatedRecords: entryCount }));
}

export async function assessDataAwareSchemaChange(params: {
  workspaceId: string;
  environmentId: string;
  modelId: string;
  actorId: string;
  proposedSchema: unknown;
}) {
  const model = await getModel(params.workspaceId, params.modelId);
  if (!model) throw Object.assign(new Error("Model not found"), { status: 404 });
  const validation = validateCanonicalSchema(params.proposedSchema);
  if (!validation.valid || !validation.schema) throw Object.assign(new Error(validation.errors.join("; ")), { status: 400 });
  if (validation.schema.apiKey !== model.api_key) throw Object.assign(new Error("apiKey cannot be changed after a model is created"), { status: 400 });

  const targetSchema = validation.schema;
  const targetHash = computeSchemaHash(targetSchema);
  const db = createServiceRoleClient();
  const [{ data: targetVersion }, { data: sourceDeployment }] = await Promise.all([
    db.from("content_model_versions").select("id,version_number,schema_hash,schema_json").eq("content_model_id", model.id).eq("schema_hash", targetHash).order("version_number", { ascending: false }).limit(1).maybeSingle(),
    db.from("environment_schema_deployments").select("id,schema_version,schema_hash,status,deployed_at,metadata_json").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).eq("content_model_id", model.id).in("status", ["deployed", "drifted"]).order("deployed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const sourceVersionNumber = Number(sourceDeployment?.schema_version ?? 0);
  const sourceVersion = sourceVersionNumber > 0 ? await getVersion(model.id, sourceVersionNumber) : null;
  const sourceDeploymentHash = String(sourceDeployment?.schema_hash ?? "") || null;
  const sourceCanonicalHash = String(sourceVersion?.schema_hash ?? "") || null;
  const sourceHashMatchesCanonical = Boolean(sourceDeploymentHash && sourceCanonicalHash && sourceDeploymentHash === sourceCanonicalHash);
  const sourceSchema = sourceVersion?.schema_json ?? {
    name: targetSchema.name,
    apiKey: targetSchema.apiKey,
    description: targetSchema.description,
    capability: targetSchema.capability,
    permissions: targetSchema.permissions,
    fields: [],
  };
  const schemaDiff = computeSchemaDiff(sourceSchema, targetSchema);
  const targetVersionNumber = Number(targetVersion?.version_number ?? (targetHash === computeSchemaHash((await getVersion(model.id, model.current_schema_version))?.schema_json ?? targetSchema) ? model.current_schema_version : 0));

  const discovered = await findDatabaseConnection(params.workspaceId, params.environmentId);
  let client: pg.Client | null = null;
  try {
    client = await connect(discovered.connectionString);
    const { rows: [identity] } = await client.query("select current_database() as database,coalesce((select ssl from pg_stat_ssl where pid=pg_backend_pid()),false) as ssl");
    const { rows: [objects] } = await client.query("select to_regclass('public.content_entries') is not null as entries,to_regclass('public.content_entry_versions') is not null as versions,to_regclass('public.content_relations') is not null as relations,to_regclass('public.content_models') is not null as models,to_regclass('public.polynovea_migration_ledger') is not null as ledger");
    if (!objects?.entries || !objects?.versions || !objects?.relations || !objects?.models) throw Object.assign(new Error("Target database does not contain the generic record engine required for data-aware inspection"), { status: 409 });

    const [{ rows: [counts] }, { rows: [sizes] }, { rows: locks }, { rows: indexes }] = await Promise.all([
      client.query(`select
        (select count(*)::bigint from public.content_entries where workspace_id=$1 and content_model_id=$2 and archived_at is null) as entry_count,
        (select count(*)::bigint from public.content_entry_versions v join public.content_entries e on e.id=v.entry_id where e.workspace_id=$1 and e.content_model_id=$2) as version_count,
        (select count(*)::bigint from public.content_relations r join public.content_entries e on e.id=r.source_entry_id where e.workspace_id=$1 and e.content_model_id=$2 and r.source_version_id=coalesce(e.current_draft_version_id,e.published_version_id)) as relation_count`, [params.workspaceId, params.modelId]),
      client.query(`select pg_total_relation_size('public.content_entries')+pg_total_relation_size('public.content_entry_versions')+pg_total_relation_size('public.content_relations') as bytes,pg_size_pretty(pg_total_relation_size('public.content_entries')+pg_total_relation_size('public.content_entry_versions')+pg_total_relation_size('public.content_relations')) as human`),
      client.query(`select mode,granted,count(*)::bigint as count from pg_locks where relation in ('public.content_entries'::regclass,'public.content_entry_versions'::regclass,'public.content_relations'::regclass) group by mode,granted`),
      client.query(`select indexname from pg_indexes where schemaname='public' and indexname=any($1::text[])`, [["content_entries_workspace_model_idx", "content_entry_versions_entry_idx", "content_relations_source_idx"]]),
    ]);
    const entryCount = toInt(counts?.entry_count);
    const versionCount = toInt(counts?.version_count);
    const activeRelationCount = toInt(counts?.relation_count);
    const ungrantedLockCount = locks.filter((row) => !row.granted).reduce((sum, row) => sum + toInt(row.count), 0);
    const exclusiveLockCount = locks.filter((row) => row.granted && ["AccessExclusiveLock", "ExclusiveLock"].includes(row.mode)).reduce((sum, row) => sum + toInt(row.count), 0);
    const indexNames = new Set(indexes.map((row) => row.indexname));
    const coreIndexesReady = ["content_entries_workspace_model_idx", "content_entry_versions_entry_idx", "content_relations_source_idx"].every((name) => indexNames.has(name));

    const ledgerPresent = Boolean(objects?.ledger);
    let latestMigration: string | null = null;
    if (ledgerPresent) latestMigration = String((await client.query("select migration_id from public.polynovea_migration_ledger order by filename desc limit 1")).rows[0]?.migration_id ?? "") || null;
    const populatedSourceProven = Boolean(sourceDeployment && sourceVersion && sourceHashMatchesCanonical && ledgerPresent);
    const provenanceState = entryCount > 0
      ? populatedSourceProven ? "proven" : "ambiguous"
      : populatedSourceProven ? "proven" : ledgerPresent ? "unverified" : "missing";
    const provenance = {
      migrationLedgerPresent: ledgerPresent,
      latestMigration,
      sourceDeploymentId: sourceDeployment?.id ?? null,
      sourceSchemaVersion: sourceVersionNumber || null,
      sourceSchemaHash: sourceDeploymentHash ?? sourceCanonicalHash,
      sourceCanonicalHash,
      sourceHashMatchesCanonical,
      targetSchemaVersion: targetVersionNumber || null,
      targetSchemaHash: targetHash,
      targetCanonicalVersionPersisted: Boolean(targetVersion),
      automaticAdoptionAllowed: entryCount === 0 || populatedSourceProven,
    };

    const fields: FieldDataProfile[] = [];
    for (const diff of schemaDiff.entries) fields.push(await profileField({ client, workspaceId: params.workspaceId, modelId: params.modelId, diff }));
    const deterministicClassification = classifyAssessment(schemaDiff.overallClassification, fields, ungrantedLockCount);
    const hardBlockers: Array<Record<string, unknown>> = [];
    const warnings: Array<Record<string, unknown>> = [];
    if (entryCount > 0 && provenanceState !== "proven") hardBlockers.push({ code: "UNPROVEN_SCHEMA_PROVENANCE", affectedRecords: entryCount, message: "Target contains records but its deployed source schema version/hash cannot be proven against the migration ledger and canonical version history. Automatic adoption/mutation is blocked until provenance is explicitly resolved." });
    if (!sourceDeployment && entryCount > 0) warnings.push({ code: "SOURCE_DEPLOYMENT_UNRECORDED", message: "No environment schema deployment record exists for this populated model; automatic mutation is blocked until deployed-source provenance is established." });
    if (sourceDeployment && !sourceVersion) warnings.push({ code: "SOURCE_CANONICAL_VERSION_MISSING", message: "The environment deployment points to a canonical schema version that is unavailable. Automatic mutation is blocked for populated targets." });
    if (sourceDeployment && sourceVersion && !sourceHashMatchesCanonical) warnings.push({ code: "SOURCE_SCHEMA_HASH_MISMATCH", message: "The environment deployment hash does not match the canonical source version hash. Automatic mutation is blocked for populated targets." });
    if (!targetVersion) warnings.push({ code: "TARGET_SCHEMA_NOT_PERSISTED", message: "The proposed schema is not a persisted canonical model version. It can be simulated but cannot be deployed until a canonical version exists." });
    for (const field of fields) {
      if (field.changeKind === "removed" && field.populatedCount) hardBlockers.push({ code: "POPULATED_FIELD_REMOVAL", fieldKey: field.fieldKey, affectedRecords: field.populatedCount });
      if ((field.incompatibleTypeCount ?? 0) > 0) hardBlockers.push({ code: "INCOMPATIBLE_TYPE_VALUES", fieldKey: field.fieldKey, affectedRecords: field.incompatibleTypeCount });
      if (field.duplicateEntryCount > 0) hardBlockers.push({ code: "DUPLICATE_VALUES", fieldKey: field.fieldKey, affectedRecords: field.duplicateEntryCount, duplicateGroups: field.duplicateGroupCount });
      if (field.relationViolationCount > 0) hardBlockers.push({ code: "RELATION_TARGET_VIOLATIONS", fieldKey: field.fieldKey, affectedRelations: field.relationViolationCount });
      if (field.missingOrNullCount > 0 && field.checks.some((check) => check.key === "required" && check.status === "failed")) hardBlockers.push({ code: "REQUIRED_BACKFILL", fieldKey: field.fieldKey, affectedRecords: field.missingOrNullCount });
      if (field.validationViolationCount > 0) hardBlockers.push({ code: "VALIDATION_VIOLATIONS", fieldKey: field.fieldKey, affectedRecords: field.validationViolationCount });
      for (const check of field.checks.filter((item) => item.status === "warning")) warnings.push({ code: `FIELD_${check.key.toUpperCase()}_REVIEW`, fieldKey: field.fieldKey, note: check.note });
    }
    if (!coreIndexesReady) warnings.push({ code: "CORE_INDEX_READINESS", message: "One or more generic record-engine indexes are missing; large backfills or relation checks may be slower than expected." });
    if (ungrantedLockCount) warnings.push({ code: "LOCK_WAITERS_PRESENT", count: ungrantedLockCount, message: "The target currently has sessions waiting on record-engine relation locks." });
    if (exclusiveLockCount) warnings.push({ code: "EXCLUSIVE_LOCKS_PRESENT", count: exclusiveLockCount, message: "The target currently has granted exclusive locks on record-engine relations." });
    if (entryCount >= 100_000 && deterministicClassification !== "safe") warnings.push({ code: "LARGE_BACKFILL_SURFACE", entryCount, message: "Large record count requires bounded batching, progress evidence and explicit maintenance/lock review." });

    const alternatives = buildAlternatives(deterministicClassification, fields, entryCount);
    const estimate = {
      methodology: "deterministic aggregate inspection of deployed-source -> canonical-target",
      entryCount,
      versionCount,
      activeRelationCount,
      tableBytes: toInt(sizes?.bytes),
      tableSizeHuman: sizes?.human ?? "unknown",
      batchRecommendation: entryCount >= 100_000 ? 1000 : entryCount >= 10_000 ? 500 : 250,
      lockRisk: exclusiveLockCount || ungrantedLockCount ? "elevated" : entryCount >= 100_000 ? "review" : "low",
      directApplyBlocked: hardBlockers.length > 0,
      sourceSchemaVersion: sourceVersionNumber || null,
      targetSchemaVersion: targetVersionNumber || null,
      note: "No raw content values are persisted in this assessment. Estimates are structural and aggregate, not wall-clock guarantees.",
    };
    const status = hardBlockers.length ? "blocked" : warnings.length ? "warning" : "passed";
    const assessment: DataAwareChangeAssessment = {
      model: { id: model.id, apiKey: model.api_key, currentVersion: model.current_schema_version },
      target: { provider: discovered.connection.connector_type, connectionId: discovered.connection.id, database: identity?.database ?? null, ssl: identity?.ssl ?? null },
      schemaDiff,
      dataProfile: { entryCount, versionCount, activeRelationCount, tableBytes: toInt(sizes?.bytes), tableSizeHuman: sizes?.human ?? "unknown", ungrantedLockCount, exclusiveLockCount, coreIndexesReady, fields },
      deterministicClassification,
      hardBlockers,
      warnings,
      alternatives,
      estimate,
    };

    const correlationId = randomUUID();
    const { data: persisted, error } = await db.from("operational_change_assessments").insert({
      workspace_id: params.workspaceId,
      environment_id: params.environmentId,
      content_model_id: params.modelId,
      current_schema_version: sourceVersionNumber || model.current_schema_version,
      source_schema_version: sourceVersionNumber || null,
      source_schema_hash: sourceDeployment?.schema_hash ?? sourceVersion?.schema_hash ?? null,
      target_schema_version: targetVersionNumber || null,
      target_schema_hash: targetHash,
      source_deployment_id: sourceDeployment?.id ?? null,
      provenance_state: provenanceState,
      provenance_json: provenance,
      proposed_schema_hash: targetHash,
      status,
      deterministic_classification: deterministicClassification,
      schema_diff_json: schemaDiff,
      data_profile_json: assessment.dataProfile,
      hard_blockers_json: hardBlockers,
      warnings_json: warnings,
      alternatives_json: alternatives,
      estimate_json: estimate,
      source_connection_id: discovered.connection.id,
      correlation_id: correlationId,
      created_by: params.actorId,
    }).select().single();
    if (error || !persisted) throw new Error(error?.message || "Could not persist data-aware change assessment");
    await db.from("operational_events").insert({
      workspace_id: params.workspaceId,
      environment_id: params.environmentId,
      event_type: "schema_change.assessment",
      source_type: "operational_change_assessment",
      source_id: persisted.id,
      correlation_id: correlationId,
      features_json: { deterministicClassification, sourceSchemaVersion: sourceVersionNumber || null, targetSchemaVersion: targetVersionNumber || null, provenanceState, entryCount, versionCount, activeRelationCount, tableBytes: toInt(sizes?.bytes), lockRisk: estimate.lockRisk, blockerCount: hardBlockers.length, warningCount: warnings.length, fieldChangeCount: fields.length },
      outcome_json: { status, directApplyBlocked: hardBlockers.length > 0 },
      privacy_class: "operational_minimized",
      eligible_for_local_learning: true,
      eligible_for_cross_install_learning: false,
    });
    await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "operational.schema_change.assessed", entityType: "content_model", entityId: params.modelId, metadata: { environmentId: params.environmentId, assessmentId: persisted.id, correlationId, status, deterministicClassification, provenanceState, sourceSchemaVersion: sourceVersionNumber || null, targetSchemaVersion: targetVersionNumber || null, blockerCount: hardBlockers.length, warningCount: warnings.length, entryCount } });
    return { assessment: persisted, analysis: assessment };
  } catch (error) {
    const safe = redactCredentials(error instanceof Error ? error.message : String(error), discovered.credentials);
    throw Object.assign(new Error(safe), { status: Number((error as any)?.status) || 400 });
  } finally {
    if (client) await client.end().catch(() => undefined);
  }
}

export async function listDataAwareChangeAssessments(workspaceId: string, environmentId: string, modelId?: string | null) {
  let query = createServiceRoleClient().from("operational_change_assessments").select("*").eq("workspace_id", workspaceId).eq("environment_id", environmentId);
  if (modelId) query = query.eq("content_model_id", modelId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}
