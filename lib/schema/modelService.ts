import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";
import { validateCanonicalSchema } from "@/lib/schema/canonicalSchema";
import { computeSchemaDiff, type SchemaDiff } from "@/lib/schema/diff";
import { resolveModelCapability, type CanonicalSchema, type ModelCapability } from "@/lib/schema/fields/types";

export interface ContentModelRow {
  id: string;
  workspace_id: string;
  name: string;
  api_key: string;
  description: string | null;
  icon: string | null;
  status: "draft" | "active" | "archived";
  current_schema_version: number;
  /**
   * A read-optimized projection of the current version's `capability` and
   * `permissions`, kept in sync by `createModel`/`applyChange` — never an
   * independently editable source. The canonical schema version's
   * `schema_json` remains authoritative (ADR-004, ADR-016).
   */
  settings_json: { capability?: ModelCapability };
  created_by: string | null;
  created_at: string;
  updated_at: string;
  current_schema?: CanonicalSchema | null;
}

export interface ContentModelVersionRow {
  id: string;
  content_model_id: string;
  version_number: number;
  schema_json: CanonicalSchema;
  schema_hash: string;
  change_summary: string | null;
  created_by: string | null;
  created_at: string;
}

export function computeSchemaHash(schema: CanonicalSchema): string {
  const stable = JSON.stringify(schema, Object.keys(schema).sort());
  return createHash("sha256").update(stable).digest("hex");
}

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export async function createModel(params: {
  workspaceId: string;
  description?: string;
  icon?: string;
  proposedSchema: unknown;
  createdBy: string;
}): Promise<ServiceResult<{ model: ContentModelRow; version: ContentModelVersionRow }>> {
  const validation = validateCanonicalSchema(params.proposedSchema);
  if (!validation.valid || !validation.schema) {
    return { ok: false, error: validation.errors.join("; "), status: 400 };
  }
  const schema = validation.schema;

  const db = createServiceRoleClient();
  const hash = computeSchemaHash(schema);
  const capability = resolveModelCapability(schema);

  const { data: rpcRes, error: rpcError } = await db.rpc("cms_create_content_model", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.createdBy,
    p_name: schema.name,
    p_api_key: schema.apiKey,
    p_description: params.description ?? null,
    p_icon: params.icon ?? null,
    p_schema_json: schema,
    p_schema_hash: hash,
    p_capability: capability,
  });

  if (rpcError || !rpcRes) {
    const isConflict = rpcError?.code === "23505" || rpcError?.message?.includes("already exists");
    return { ok: false, error: rpcError?.message ?? "Failed to create content model", status: isConflict ? 409 : 500 };
  }

  const result = rpcRes as { model: ContentModelRow; version: ContentModelVersionRow };
  return { ok: true, data: result };
}

export async function rebuildContentFields(contentModelId: string, schema: CanonicalSchema): Promise<void> {
  const db = createServiceRoleClient();
  const { error: delError } = await db.from("content_fields").delete().eq("content_model_id", contentModelId);
  if (delError) throw new Error(`Failed to clear content_fields: ${delError.message}`);
  if (schema.fields.length === 0) return;

  const rows = schema.fields.map((field, index) => ({
    content_model_id: contentModelId,
    field_key: field.key,
    label: field.label,
    field_type: field.type,
    position: index,
    configuration_json: {
      required: field.required,
      localized: field.localized,
      unique: field.unique,
      defaultValue: field.defaultValue ?? null,
      validation: field.validation ?? {},
      relation: field.relation ?? null,
      generatedFrom: field.generatedFrom ?? null,
      index: field.index ?? false,
      providerSpecific: field.providerSpecific ?? false,
      uiHints: field.uiHints ?? {},
    },
  }));

  const { error: insError } = await db.from("content_fields").insert(rows);
  if (insError) throw new Error(`Failed to insert content_fields: ${insError.message}`);
}

export async function getModel(workspaceId: string, modelId: string): Promise<ContentModelRow | null> {
  const db = createServiceRoleClient();
  const { data } = await db.from("content_models").select("*").eq("workspace_id", workspaceId).eq("id", modelId).maybeSingle();
  return data ?? null;
}

export async function listModels(workspaceId: string): Promise<ContentModelRow[]> {
  const db = createServiceRoleClient();
  const { data: models } = await db.from("content_models").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
  if (!models || models.length === 0) return [];

  const modelIds = models.map((m) => m.id);
  const { data: versions } = await db
    .from("content_model_versions")
    .select("content_model_id, version_number, schema_json")
    .in("content_model_id", modelIds);

  const versionMap = new Map<string, CanonicalSchema>();
  for (const v of versions || []) {
    versionMap.set(`${v.content_model_id}:${v.version_number}`, v.schema_json as CanonicalSchema);
  }

  return models.map((m) => ({
    ...m,
    current_schema: versionMap.get(`${m.id}:${m.current_schema_version}`) ?? null,
  }));
}

export async function listVersions(modelId: string): Promise<ContentModelVersionRow[]> {
  const db = createServiceRoleClient();
  const { data } = await db
    .from("content_model_versions")
    .select("*")
    .eq("content_model_id", modelId)
    .order("version_number", { ascending: false });
  return data ?? [];
}

export async function getVersion(modelId: string, versionNumber: number): Promise<ContentModelVersionRow | null> {
  const db = createServiceRoleClient();
  const { data } = await db
    .from("content_model_versions")
    .select("*")
    .eq("content_model_id", modelId)
    .eq("version_number", versionNumber)
    .maybeSingle();
  return data ?? null;
}

export async function diffVersions(
  modelId: string,
  fromVersion: number,
  toVersion: number,
): Promise<ServiceResult<SchemaDiff>> {
  const [from, to] = await Promise.all([getVersion(modelId, fromVersion), getVersion(modelId, toVersion)]);
  if (!from) return { ok: false, error: `Version ${fromVersion} not found`, status: 404 };
  if (!to) return { ok: false, error: `Version ${toVersion} not found`, status: 404 };
  return { ok: true, data: computeSchemaDiff(from.schema_json, to.schema_json) };
}

export interface ProposeChangeResult {
  diff: SchemaDiff;
  proposedSchema: CanonicalSchema;
  currentVersion: ContentModelVersionRow;
}

async function proposeChange(model: ContentModelRow, proposedSchema: unknown): Promise<ServiceResult<ProposeChangeResult>> {
  const validation = validateCanonicalSchema(proposedSchema);
  if (!validation.valid || !validation.schema) {
    return { ok: false, error: validation.errors.join("; "), status: 400 };
  }
  if (validation.schema.apiKey !== model.api_key) {
    return { ok: false, error: "apiKey cannot be changed after a model is created", status: 400 };
  }

  const currentVersion = await getVersion(model.id, model.current_schema_version);
  if (!currentVersion) {
    return { ok: false, error: "Current schema version not found — data integrity issue", status: 500 };
  }

  const diff = computeSchemaDiff(currentVersion.schema_json, validation.schema);
  return { ok: true, data: { diff, proposedSchema: validation.schema, currentVersion } };
}

export async function validateChange(model: ContentModelRow, proposedSchema: unknown): Promise<ServiceResult<ProposeChangeResult>> {
  return proposeChange(model, proposedSchema);
}

export interface ApplyChangeResult {
  applied: boolean;
  diff: SchemaDiff;
  version?: ContentModelVersionRow;
  blockedReason?: string;
  /** A reviewed schema identical to the current version is never versioned again. */
  noChanges?: boolean;
}

export async function applyChange(params: {
  model: ContentModelRow;
  proposedSchema: unknown;
  changeSummary?: string;
  acknowledgeUnsafe: boolean;
  actorAdminUserId: string;
}): Promise<ServiceResult<ApplyChangeResult>> {
  const proposed = await proposeChange(params.model, params.proposedSchema);
  if (!proposed.ok) return proposed;

  const { diff, proposedSchema, currentVersion } = proposed.data;

  if (diff.entries.length === 0) {
    return {
      ok: true,
      data: {
        applied: false,
        noChanges: true,
        diff,
        blockedReason: "No schema changes to apply",
      },
    };
  }

  if (diff.overallClassification !== "SAFE" && !params.acknowledgeUnsafe) {
    return {
      ok: true,
      data: {
        applied: false,
        diff,
        blockedReason: `Change classified as ${diff.overallClassification} — pass acknowledgeUnsafe: true to apply anyway`,
      },
    };
  }

  await logPlatformEvent({
    workspaceId: params.model.workspace_id,
    actorAdminUserId: params.actorAdminUserId,
    action: "schema.migration.started",
    entityType: "content_model",
    entityId: params.model.id,
    metadata: { fromVersion: currentVersion.version_number, toVersion: currentVersion.version_number + 1 },
  });

  const db = createServiceRoleClient();
  const hash = computeSchemaHash(proposedSchema);
  const capability = resolveModelCapability(proposedSchema);
  const nextVersionNumber = params.model.current_schema_version + 1;

  const { data: rpcRes, error: rpcError } = await db.rpc("cms_apply_model_schema_version", {
    p_workspace_id: params.model.workspace_id,
    p_actor_id: params.actorAdminUserId,
    p_model_id: params.model.id,
    p_schema_json: proposedSchema,
    p_schema_hash: hash,
    p_change_summary: params.changeSummary ?? null,
    p_capability: capability,
  });

  if (rpcError || !rpcRes) {
    await logPlatformEvent({
      workspaceId: params.model.workspace_id,
      actorAdminUserId: params.actorAdminUserId,
      action: "schema.migration.failed",
      entityType: "content_model",
      entityId: params.model.id,
      metadata: { error: rpcError?.message },
    });
    return { ok: false, error: rpcError?.message ?? "Failed to apply schema version", status: 500 };
  }

  const version = (rpcRes as { version: ContentModelVersionRow }).version;
  return { ok: true, data: { applied: true, diff, version } };
}
