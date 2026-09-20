import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";
import { extractAssetReferences, extractEntryRelations, extractInternalPathReferences, validateEntryData } from "@/lib/content/entryValidation";
import { getModel, getVersion, type ContentModelRow, type ContentModelVersionRow } from "@/lib/schema/modelService";
import type { CanonicalSchema } from "@/lib/schema/fields/types";
import { indexEntry, searchableText } from "@/lib/content/searchService";
import { normalizePath } from "@/lib/routing/routeService";

export type EntryState = "draft" | "in_review" | "approved" | "scheduled" | "published" | "archived";
export interface ContentEntryRow { id: string; workspace_id: string; content_model_id: string; status: EntryState; current_draft_version_id: string | null; published_version_id: string | null; created_by: string | null; updated_by: string | null; created_at: string; updated_at: string; archived_at: string | null; status_before_archive: EntryState | null; }
export interface ContentEntryVersionRow { id: string; entry_id: string; model_schema_version: number; version_number: number; data_jsonb: Record<string, unknown>; locale: string; state: EntryState; created_by: string | null; created_at: string; change_summary: string | null; }
export type EntryResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

async function currentSchema(model: ContentModelRow): Promise<EntryResult<{ version: ContentModelVersionRow; schema: CanonicalSchema }>> {
  const version = await getVersion(model.id, model.current_schema_version);
  if (!version) return { ok: false, error: "Current model schema is unavailable", status: 500 };
  return { ok: true, data: { version, schema: version.schema_json } };
}

async function verifyUniqueValues(params: { workspaceId: string; modelId: string; schema: CanonicalSchema; data: Record<string, unknown>; exceptEntryId?: string }): Promise<EntryResult<void>> {
  const fields = params.schema.fields.filter((field) => field.unique && params.data[field.key] !== undefined && params.data[field.key] !== null && params.data[field.key] !== "");
  if (!fields.length) return { ok: true, data: undefined };
  const db = createServiceRoleClient();
  // Do not use a nested PostgREST relation projection here. content_entries
  // has several version foreign keys (draft/published plus the version's
  // entry_id), which makes an unqualified embedded relation ambiguous in
  // Supabase. Resolve current version ids explicitly instead.
  const { data: entries, error } = await db.from("content_entries").select("id, current_draft_version_id, published_version_id").eq("workspace_id", params.workspaceId).eq("content_model_id", params.modelId);
  if (error) return { ok: false, error: "Could not verify unique fields", status: 500 };
  const versionIds = [...new Set((entries ?? []).flatMap((entry: { current_draft_version_id: string | null; published_version_id: string | null }) => [entry.current_draft_version_id, entry.published_version_id].filter((id): id is string => Boolean(id))))];
  if (versionIds.length === 0) return { ok: true, data: undefined };
  const { data: versions, error: versionError } = await db.from("content_entry_versions").select("entry_id, data_jsonb").in("id", versionIds);
  if (versionError) return { ok: false, error: "Could not verify unique fields", status: 500 };
  for (const field of fields) {
    const value = params.data[field.key];
    const conflict = (versions ?? []).some((version: { entry_id: string; data_jsonb: Record<string, unknown> }) => version.entry_id !== params.exceptEntryId && version.data_jsonb?.[field.key] === value);
    if (conflict) return { ok: false, error: `"${field.label}" must be unique for this content model`, status: 409 };
  }
  return { ok: true, data: undefined };
}

async function verifyRelations(workspaceId: string, sourceEntryId: string, schema: CanonicalSchema, data: Record<string, unknown>): Promise<EntryResult<void>> {
  const relations = extractEntryRelations(schema, data);
  if (relations.some((relation) => relation.targetEntryId === sourceEntryId)) return { ok: false, error: "An entry cannot reference itself", status: 400 };
  if (relations.length === 0) return { ok: true, data: undefined };
  const db = createServiceRoleClient();
  const targetIds = [...new Set(relations.map((relation) => relation.targetEntryId))];
  const { data: targets, error } = await db.from("content_entries").select("id, workspace_id, content_model_id").in("id", targetIds).eq("workspace_id", workspaceId);
  if (error || (targets ?? []).length !== targetIds.length) return { ok: false, error: "One or more related entries do not exist in this workspace", status: 400 };
  const modelIds = [...new Set((targets ?? []).map((target: { content_model_id: string }) => target.content_model_id))];
  const { data: targetModels } = await db.from("content_models").select("id, api_key").in("id", modelIds).eq("workspace_id", workspaceId);
  const apiKeyByModel = new Map((targetModels ?? []).map((target: { id: string; api_key: string }) => [target.id, target.api_key]));
  for (const relation of relations) {
    const target = (targets ?? []).find((candidate: { id: string }) => candidate.id === relation.targetEntryId) as { content_model_id: string } | undefined;
    const field = schema.fields.find((candidate) => candidate.key === relation.fieldKey);
    if (!target || !field?.relation || apiKeyByModel.get(target.content_model_id) !== field.relation.targetModelApiKey) return { ok: false, error: `Relation "${relation.fieldKey}" targets the wrong content model`, status: 400 };
  }
  return { ok: true, data: undefined };
}

type EntryGraphRelationPayload = {
  fieldKey: string;
  relationType: string;
  targetEntityType: "entry" | "asset" | "route";
  targetEntryId?: string;
  targetAssetId?: string;
  targetRouteId?: string;
};

async function buildGraphRelations(params: { workspaceId: string; schema: CanonicalSchema; data: Record<string, unknown>; locale: string }): Promise<EntryResult<EntryGraphRelationPayload[]>> {
  const rows: EntryGraphRelationPayload[] = extractEntryRelations(params.schema, params.data).map((relation) => ({
    fieldKey: relation.fieldKey, targetEntryId: relation.targetEntryId, targetEntityType: "entry", relationType: relation.relationType,
  }));
  const db = createServiceRoleClient();
  const assetRefs = extractAssetReferences(params.schema, params.data);
  if (assetRefs.length) {
    const assetIds = [...new Set(assetRefs.map((item) => item.assetId))];
    const { data: assets, error } = await db.from("assets").select("id, archived_at").eq("workspace_id", params.workspaceId).in("id", assetIds);
    if (error || (assets ?? []).length !== assetIds.length || (assets ?? []).some((asset) => asset.archived_at)) {
      return { ok: false, error: "One or more media assets do not exist in this workspace or are archived", status: 400 };
    }
    for (const ref of assetRefs) rows.push({ fieldKey: ref.fieldKey, targetAssetId: ref.assetId, targetEntityType: "asset", relationType: "media_asset" });
  }

  const pathRefs = extractInternalPathReferences(params.schema, params.data)
    .map((ref) => ({ ...ref, normalized: normalizePath(ref.path) }))
    .filter((ref) => ref.normalized.ok) as Array<{ fieldKey: string; path: string; normalized: { ok: true; path: string } }>;
  const paths = [...new Set(pathRefs.map((ref) => ref.normalized.path))];
  if (paths.length) {
    const { data: routes } = await db.from("content_routes").select("id,path").eq("workspace_id", params.workspaceId).eq("locale", params.locale).neq("status", "archived").in("path", paths);
    const routeByPath = new Map((routes ?? []).map((route) => [route.path, route.id]));
    for (const ref of pathRefs) {
      const routeId = routeByPath.get(ref.normalized.path);
      if (routeId) rows.push({ fieldKey: ref.fieldKey, targetRouteId: routeId, targetEntityType: "route", relationType: "internal_link" });
    }
  }

  const unique = new Map<string, EntryGraphRelationPayload>();
  for (const row of rows) {
    const id = row.targetEntryId ?? row.targetAssetId ?? row.targetRouteId ?? "";
    unique.set(`${row.fieldKey}:${row.targetEntityType}:${id}:${row.relationType}`, row);
  }
  return { ok: true, data: [...unique.values()] };
}

export async function listEntries(workspaceId: string, modelId?: string): Promise<(ContentEntryRow & { data?: Record<string, unknown> })[]> {
  const db = createServiceRoleClient();
  let query = db.from("content_entries").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false });
  if (modelId) query = query.eq("content_model_id", modelId);
  const { data } = await query;
  if (!data || data.length === 0) return [];

  const versionIds = [...new Set(data.map((e: ContentEntryRow) => e.current_draft_version_id || e.published_version_id).filter(Boolean))] as string[];
  if (versionIds.length > 0) {
    const { data: versions } = await db
      .from("content_entry_versions")
      .select("id, entry_id, data_jsonb")
      .in("id", versionIds);
    const dataMap = new Map((versions || []).map((v: { id: string; data_jsonb: Record<string, unknown> }) => [v.id, v.data_jsonb]));
    return data.map((e: ContentEntryRow) => ({
      ...e,
      data: (e.current_draft_version_id && dataMap.get(e.current_draft_version_id)) || (e.published_version_id && dataMap.get(e.published_version_id)) || {},
    }));
  }

  return data;
}

export async function getEntry(workspaceId: string, entryId: string): Promise<ContentEntryRow | null> {
  const { data } = await createServiceRoleClient().from("content_entries").select("*").eq("workspace_id", workspaceId).eq("id", entryId).maybeSingle();
  return data ?? null;
}

export async function listEntryVersions(entryId: string): Promise<ContentEntryVersionRow[]> {
  const { data } = await createServiceRoleClient().from("content_entry_versions").select("*").eq("entry_id", entryId).order("version_number", { ascending: false });
  return data ?? [];
}

function extractUniqueReservations(schema: CanonicalSchema, data: Record<string, unknown>): Array<{ fieldKey: string; normalizedValue: string }> {
  const result: Array<{ fieldKey: string; normalizedValue: string }> = [];
  for (const field of schema.fields) {
    if (field.unique && data[field.key] !== undefined && data[field.key] !== null && data[field.key] !== "") {
      const normalizedValue = String(data[field.key]).trim();
      if (normalizedValue) {
        result.push({ fieldKey: field.key, normalizedValue });
      }
    }
  }
  return result;
}

export async function createEntry(params: { workspaceId: string; modelId: string; data: Record<string, unknown>; locale?: string; actorAdminUserId: string; changeSummary?: string }): Promise<EntryResult<{ entry: ContentEntryRow; version: ContentEntryVersionRow }>> {
  const model = await getModel(params.workspaceId, params.modelId);
  if (!model || model.status !== "active") return { ok: false, error: "Active content model not found", status: 404 };
  const schemaResult = await currentSchema(model); if (!schemaResult.ok) return schemaResult;
  const errors = validateEntryData(schemaResult.data.schema, params.data); if (errors.length) return { ok: false, error: errors.join("; "), status: 400 };
  const uniqueCheck = await verifyUniqueValues({ workspaceId: params.workspaceId, modelId: model.id, schema: schemaResult.data.schema, data: params.data }); if (!uniqueCheck.ok) return uniqueCheck;
  const relationCheck = await verifyRelations(params.workspaceId, "__new_entry__", schemaResult.data.schema, params.data); if (!relationCheck.ok) return relationCheck;

  const uniqueReservations = extractUniqueReservations(schemaResult.data.schema, params.data);
  const graphRelations = await buildGraphRelations({ workspaceId: params.workspaceId, schema: schemaResult.data.schema, data: params.data, locale: params.locale ?? "en" });
  if (!graphRelations.ok) return graphRelations;
  const searchText = searchableText(params.data);

  const db = createServiceRoleClient();
  const { data: rpcRes, error: rpcError } = await db.rpc("cms_create_content_entry", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorAdminUserId,
    p_model_id: model.id,
    p_data_jsonb: params.data,
    p_locale: params.locale ?? "en",
    p_change_summary: params.changeSummary ?? "Initial draft",
    p_unique_reservations: uniqueReservations,
    p_relations: graphRelations.data,
    p_search_text: searchText,
  });

  if (rpcError || !rpcRes) {
    const isConflict = rpcError?.code === "23505" || rpcError?.message?.includes("unique_values") || rpcError?.message?.includes("unique");
    return {
      ok: false,
      error: isConflict ? "One or more unique fields conflict with an existing entry in this content model" : (rpcError?.message ?? "Could not create entry"),
      status: isConflict ? 409 : 500,
    };
  }

  const { entry, version } = rpcRes as { entry: ContentEntryRow; version: ContentEntryVersionRow };
  return { ok: true, data: { entry, version } };
}

export interface DraftConflict { currentVersion: ContentEntryVersionRow }

export async function saveDraft(params: { workspaceId: string; entryId: string; data: Record<string, unknown>; locale?: string; actorAdminUserId: string; changeSummary?: string; expectedVersionNumber?: number }): Promise<EntryResult<{ entry: ContentEntryRow; version: ContentEntryVersionRow }> | { ok: false; error: string; status: 409; conflict: DraftConflict }> {
  const entry = await getEntry(params.workspaceId, params.entryId); if (!entry) return { ok: false, error: "Entry not found", status: 404 };
  if (entry.status === "archived") return { ok: false, error: "Archived entries cannot be edited", status: 409 };
  const model = await getModel(params.workspaceId, entry.content_model_id); if (!model) return { ok: false, error: "Content model not found", status: 500 };
  const schemaResult = await currentSchema(model); if (!schemaResult.ok) return schemaResult;
  const existing = await listEntryVersions(entry.id);
  if (params.expectedVersionNumber !== undefined && (existing[0]?.version_number ?? 0) !== params.expectedVersionNumber) {
    return {
      ok: false,
      error: "This entry was changed by someone else since you started editing — review the latest version before saving",
      status: 409,
      conflict: { currentVersion: existing[0] },
    };
  }
  const errors = validateEntryData(schemaResult.data.schema, params.data); if (errors.length) return { ok: false, error: errors.join("; "), status: 400 };
  const uniqueCheck = await verifyUniqueValues({ workspaceId: params.workspaceId, modelId: model.id, schema: schemaResult.data.schema, data: params.data, exceptEntryId: entry.id }); if (!uniqueCheck.ok) return uniqueCheck;
  const relationCheck = await verifyRelations(params.workspaceId, entry.id, schemaResult.data.schema, params.data); if (!relationCheck.ok) return relationCheck;

  const uniqueReservations = extractUniqueReservations(schemaResult.data.schema, params.data);
  const graphRelations = await buildGraphRelations({ workspaceId: params.workspaceId, schema: schemaResult.data.schema, data: params.data, locale: params.locale ?? existing[0]?.locale ?? "en" });
  if (!graphRelations.ok) return graphRelations;
  const searchText = searchableText(params.data);

  const db = createServiceRoleClient();
  const { data: rpcRes, error: rpcError } = await db.rpc("cms_save_entry_draft", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorAdminUserId,
    p_entry_id: entry.id,
    p_data_jsonb: params.data,
    p_locale: params.locale ?? "en",
    p_change_summary: params.changeSummary ?? null,
    p_expected_version_number: params.expectedVersionNumber ?? null,
    p_unique_reservations: uniqueReservations,
    p_relations: graphRelations.data,
    p_search_text: searchText,
  });

  if (rpcError || !rpcRes) {
    if (rpcError?.code === "P0002" || rpcError?.message?.includes("Version conflict")) {
      const latestList = await listEntryVersions(entry.id);
      return {
        ok: false,
        error: "This entry was changed by someone else since you started editing — review the latest version before saving",
        status: 409,
        conflict: { currentVersion: latestList[0] },
      };
    }
    const isConflict = rpcError?.code === "23505" || rpcError?.message?.includes("unique_values");
    return {
      ok: false,
      error: isConflict ? "One or more unique fields conflict with an existing entry in this content model" : (rpcError?.message ?? "Could not save draft"),
      status: isConflict ? 409 : 500,
    };
  }

  const { entry: updated, version } = rpcRes as { entry: ContentEntryRow; version: ContentEntryVersionRow };
  return { ok: true, data: { entry: updated, version } };
}

export async function publishEntry(params: { workspaceId: string; entryId: string; actorAdminUserId: string }): Promise<EntryResult<ContentEntryRow>> {
  const entry = await getEntry(params.workspaceId, params.entryId); if (!entry || !entry.current_draft_version_id) return { ok: false, error: "Draft entry not found", status: 404 };
  if (entry.status !== "approved") return { ok: false, error: "Entry must be approved before publishing", status: 409 };

  const model = await getModel(params.workspaceId, entry.content_model_id);
  if (model?.settings_json?.capability === "data_only") {
    return { ok: false, error: `Cannot publish entry: model "${model.api_key}" has capability "data_only"`, status: 409 };
  }

  const db = createServiceRoleClient();
  const { data: rpcRes, error: rpcError } = await db.rpc("cms_publish_content_entry", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorAdminUserId,
    p_entry_id: entry.id,
  });

  if (rpcError || !rpcRes) {
    const isConflict = rpcError?.message?.includes("approved") || rpcError?.code === "P0003" || rpcError?.message?.includes("data_only");
    return { ok: false, error: rpcError?.message ?? "Could not publish entry", status: isConflict ? 409 : 500 };
  }

  const updated = rpcRes as ContentEntryRow;
  return { ok: true, data: updated };
}

/** Restoring never mutates history: it creates a fresh draft from the selected version. */
export async function restoreEntryVersion(params: { workspaceId: string; entryId: string; versionId: string; actorAdminUserId: string }): Promise<EntryResult<{ entry: ContentEntryRow; version: ContentEntryVersionRow }>> {
  const entry = await getEntry(params.workspaceId, params.entryId); if (!entry) return { ok: false, error: "Entry not found", status: 404 };
  const { data: sourceVersion } = await createServiceRoleClient().from("content_entry_versions").select("*").eq("id", params.versionId).eq("entry_id", entry.id).maybeSingle();
  if (!sourceVersion) return { ok: false, error: "Version not found for this entry", status: 404 };
  const result = await saveDraft({ workspaceId: params.workspaceId, entryId: entry.id, data: sourceVersion.data_jsonb, locale: sourceVersion.locale, actorAdminUserId: params.actorAdminUserId, changeSummary: `Restored from version ${sourceVersion.version_number}` });
  if (result.ok) await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorAdminUserId, action: "content.entry.version_restored", entityType: "content_entry", entityId: entry.id, metadata: { sourceVersionId: params.versionId, sourceVersionNumber: sourceVersion.version_number, restoredVersionNumber: result.data.version.version_number } });
  return result;
}

export async function archiveEntry(params: { workspaceId: string; entryId: string; actorAdminUserId: string }): Promise<EntryResult<ContentEntryRow>> {
  const entry = await getEntry(params.workspaceId, params.entryId); if (!entry) return { ok: false, error: "Entry not found", status: 404 };
  if (entry.status === "archived") return { ok: false, error: "Entry is already archived", status: 409 };
  const db = createServiceRoleClient();
  const { data: rpcRes, error: rpcError } = await db.rpc("cms_archive_content_entry", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorAdminUserId,
    p_entry_id: entry.id,
  });
  if (rpcError || !rpcRes) {
    return { ok: false, error: rpcError?.message ?? "Could not archive entry", status: 500 };
  }
  return { ok: true, data: rpcRes as ContentEntryRow };
}

/**
 * Restores the exact status the entry had right before it was archived.
 * Handled atomically inside cms_unarchive_content_entry PostgreSQL function.
 */
export async function unarchiveEntry(params: { workspaceId: string; entryId: string; actorAdminUserId: string }): Promise<EntryResult<ContentEntryRow>> {
  const entry = await getEntry(params.workspaceId, params.entryId); if (!entry) return { ok: false, error: "Entry not found", status: 404 };
  if (entry.status !== "archived") return { ok: false, error: "Entry is not archived", status: 409 };
  const db = createServiceRoleClient();
  const { data: rpcRes, error: rpcError } = await db.rpc("cms_unarchive_content_entry", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorAdminUserId,
    p_entry_id: entry.id,
  });
  if (rpcError || !rpcRes) {
    return { ok: false, error: rpcError?.message ?? "Could not restore entry from archive", status: 500 };
  }
  return { ok: true, data: rpcRes as ContentEntryRow };
}

export interface BulkOperationResult { id: string; ok: boolean; error?: string }

export async function bulkArchiveEntries(params: { workspaceId: string; entryIds: string[]; actorAdminUserId: string }): Promise<BulkOperationResult[]> {
  const results: BulkOperationResult[] = [];
  for (const entryId of params.entryIds) {
    const result = await archiveEntry({ workspaceId: params.workspaceId, entryId, actorAdminUserId: params.actorAdminUserId });
    results.push(result.ok ? { id: entryId, ok: true } : { id: entryId, ok: false, error: result.error });
  }
  return results;
}

export async function bulkUnarchiveEntries(params: { workspaceId: string; entryIds: string[]; actorAdminUserId: string }): Promise<BulkOperationResult[]> {
  const results: BulkOperationResult[] = [];
  for (const entryId of params.entryIds) {
    const result = await unarchiveEntry({ workspaceId: params.workspaceId, entryId, actorAdminUserId: params.actorAdminUserId });
    results.push(result.ok ? { id: entryId, ok: true } : { id: entryId, ok: false, error: result.error });
  }
  return results;
}

export interface EntryExportRow { id: string; status: EntryState; updatedAt: string; data: Record<string, unknown> }

/** Exports the current (published if available, else latest draft) data for every entry of one model, workspace-scoped. */
export async function exportEntries(workspaceId: string, modelId: string): Promise<EntryResult<{ modelName: string; apiKey: string; rows: EntryExportRow[] }>> {
  const model = await getModel(workspaceId, modelId);
  if (!model) return { ok: false, error: "Content model not found", status: 404 };
  const entries = await listEntries(workspaceId, modelId);
  const versionIds = entries.map((entry) => entry.published_version_id ?? entry.current_draft_version_id).filter((v): v is string => Boolean(v));
  const db = createServiceRoleClient();
  const { data: versions } = versionIds.length ? await db.from("content_entry_versions").select("id, data_jsonb").in("id", versionIds) : { data: [] as Array<{ id: string; data_jsonb: Record<string, unknown> }> };
  const dataByVersionId = new Map((versions ?? []).map((v) => [v.id, v.data_jsonb]));
  const rows: EntryExportRow[] = entries.map((entry) => {
    const versionId = entry.published_version_id ?? entry.current_draft_version_id;
    return { id: entry.id, status: entry.status, updatedAt: entry.updated_at, data: (versionId && dataByVersionId.get(versionId)) || {} };
  });
  return { ok: true, data: { modelName: model.name, apiKey: model.api_key, rows } };
}

export interface ImportRowResult { index: number; ok: boolean; errors: string[]; entryId?: string }

/**
 * Validates (and, unless `dryRun`, creates) one row per element of `rows`
 * against the model's current schema — the same validation, uniqueness and
 * relation-integrity path `createEntry` uses, so a dry run's "would pass"
 * verdict is not a separate, weaker check. Uniqueness is checked both
 * against already-stored entries and against earlier rows in the same
 * batch, so two duplicate rows in one file are both flagged even before
 * either has been written.
 */
export async function importEntries(params: { workspaceId: string; modelId: string; rows: Record<string, unknown>[]; dryRun: boolean; actorAdminUserId: string }): Promise<EntryResult<{ results: ImportRowResult[]; succeeded: number; failed: number }>> {
  const model = await getModel(params.workspaceId, params.modelId);
  if (!model || model.status !== "active") return { ok: false, error: "Active content model not found", status: 404 };
  const schemaResult = await currentSchema(model); if (!schemaResult.ok) return schemaResult;
  const schema = schemaResult.data.schema;

  const seenInBatch = new Map<string, Set<unknown>>();
  const results: ImportRowResult[] = [];

  for (let index = 0; index < params.rows.length; index += 1) {
    const row = params.rows[index];
    const errors = validateEntryData(schema, row);

    for (const field of schema.fields.filter((f) => f.unique)) {
      const value = row[field.key];
      if (value === undefined || value === null || value === "") continue;
      const seen = seenInBatch.get(field.key) ?? new Set();
      if (seen.has(value)) errors.push(`"${field.label}" duplicates another row earlier in this import`);
      seen.add(value);
      seenInBatch.set(field.key, seen);
    }

    if (errors.length === 0) {
      const uniqueCheck = await verifyUniqueValues({ workspaceId: params.workspaceId, modelId: model.id, schema, data: row });
      if (!uniqueCheck.ok) errors.push(uniqueCheck.error);
    }
    if (errors.length === 0) {
      const relationCheck = await verifyRelations(params.workspaceId, "", schema, row);
      if (!relationCheck.ok) errors.push(relationCheck.error);
    }

    if (errors.length > 0) { results.push({ index, ok: false, errors }); continue; }

    if (params.dryRun) { results.push({ index, ok: true, errors: [] }); continue; }

    const created = await createEntry({ workspaceId: params.workspaceId, modelId: model.id, data: row, actorAdminUserId: params.actorAdminUserId, changeSummary: "Imported" });
    results.push(created.ok ? { index, ok: true, errors: [], entryId: created.data.entry.id } : { index, ok: false, errors: [created.error] });
  }

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: params.dryRun ? "content.entry.import_dry_run" : "content.entry.imported",
    entityType: "content_model",
    entityId: model.id,
    metadata: { total: results.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length },
  });

  return { ok: true, data: { results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length } };
}

export interface EntryOption { id: string; label: string; status: EntryState }

/** Human-readable {id,label} options for a model's entries — powers relation pickers. Workspace- and model-scoped. */
export async function listEntryOptions(workspaceId: string, modelId: string): Promise<EntryOption[]> {
  const model = await getModel(workspaceId, modelId);
  if (!model) return [];
  const schemaResult = await currentSchema(model);
  if (!schemaResult.ok) return [];
  const labelField = schemaResult.data.schema.fields.find((f) => ["text", "slug", "email"].includes(f.type)) ?? schemaResult.data.schema.fields[0];
  const entries = await listEntries(workspaceId, modelId);
  const versionIds = entries.map((entry) => entry.published_version_id ?? entry.current_draft_version_id).filter((v): v is string => Boolean(v));
  const db = createServiceRoleClient();
  const { data: versions } = versionIds.length ? await db.from("content_entry_versions").select("id, data_jsonb").in("id", versionIds) : { data: [] as Array<{ id: string; data_jsonb: Record<string, unknown> }> };
  const dataByVersionId = new Map((versions ?? []).map((v) => [v.id, v.data_jsonb]));
  return entries.map((entry) => {
    const versionId = entry.published_version_id ?? entry.current_draft_version_id;
    const data = versionId ? dataByVersionId.get(versionId) : undefined;
    const label = labelField && data ? String(data[labelField.key] ?? "") : "";
    return { id: entry.id, label: label || `#${entry.id.slice(0, 8)}`, status: entry.status };
  });
}
