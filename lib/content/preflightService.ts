import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { extractEntryRelations } from "@/lib/content/entryValidation";
import { getEntry, listEntryVersions } from "@/lib/content/entryService";
import { getModel, getVersion } from "@/lib/schema/modelService";
import { evaluatePreflight, type PreflightResult } from "@/lib/content/preflightRules";
import { evaluateDestinationAssurance, type AssuranceDestination } from "@/lib/content/assuranceService";

export interface PreflightReport {
  entryId: string;
  versionId?: string;
  status: "ready" | "blocked";
  summary: { blocking: number; warnings: number; passed: number };
  results: PreflightResult[];
  destinations: AssuranceDestination[];
  toolingBoundary: string;
}

async function evaluateEntryVersion(params: {
  workspaceId: string;
  entryId: string;
  versionId: string;
  coordinatedEntryIds?: string[];
}): Promise<PreflightReport | null> {
  const entry = await getEntry(params.workspaceId, params.entryId);
  if (!entry) return null;
  const [model, versions] = await Promise.all([
    getModel(params.workspaceId, entry.content_model_id),
    listEntryVersions(entry.id),
  ]);
  if (!model) return null;
  const version = versions.find((item) => item.id === params.versionId);
  if (!version) return null;

  const [schemaVersion, siblingEntries] = await Promise.all([
    getVersion(model.id, version.model_schema_version),
    createServiceRoleClient()
      .from("content_entries")
      .select("id, current_draft_version_id")
      .eq("workspace_id", params.workspaceId)
      .eq("content_model_id", model.id)
      .neq("id", entry.id),
  ]);
  if (!schemaVersion) return null;
  const schema = schemaVersion.schema_json;
  const db = createServiceRoleClient();
  const siblingVersionIds = (siblingEntries.data ?? [])
    .map((item) => item.current_draft_version_id)
    .filter((id): id is string => Boolean(id));
  const { data: siblingVersions } = siblingVersionIds.length
    ? await db.from("content_entry_versions").select("data_jsonb").in("id", siblingVersionIds)
    : { data: [] as Array<{ data_jsonb: Record<string, unknown> }> };
  const duplicateFields = schema.fields
    .filter(
      (field) =>
        field.unique &&
        version.data_jsonb[field.key] !== undefined &&
        (siblingVersions ?? []).some((candidate) => candidate.data_jsonb[field.key] === version.data_jsonb[field.key])
    )
    .map((field) => field.key);

  const relations = extractEntryRelations(schema, version.data_jsonb);
  const ids = [...new Set(relations.map((item) => item.targetEntryId))];
  const { data: targets } = ids.length
    ? await db.from("content_entries").select("id, status").eq("workspace_id", params.workspaceId).in("id", ids)
    : { data: [] as Array<{ id: string; status: string }> };
  const targetById = new Map((targets ?? []).map((target) => [target.id, target]));
  const coordinated = new Set(params.coordinatedEntryIds ?? []);
  const missingRelations = relations
    .filter((item) => !targetById.has(item.targetEntryId))
    .map((item) => item.fieldKey);
  const unpublishedRelations = relations
    .filter((item) => {
      const target = targetById.get(item.targetEntryId);
      return Boolean(target && target.status !== "published" && !coordinated.has(item.targetEntryId));
    })
    .map((item) => item.fieldKey);

  let effectiveStatus = entry.status;
  if (entry.current_draft_version_id !== version.id || !["approved", "published"].includes(entry.status)) {
    const { data: approval } = await db
      .from("workflow_instances")
      .select("id")
      .eq("entry_id", entry.id)
      .eq("version_id", version.id)
      .eq("current_state", "approved")
      .not("completed_at", "is", null)
      .limit(1)
      .maybeSingle();
    if (approval) effectiveStatus = "approved";
  }

  const baseResults = evaluatePreflight({
    schema,
    data: version.data_jsonb,
    entryStatus: effectiveStatus,
    duplicateFields,
    missingRelations,
    unpublishedRelations,
    previewAvailable: true,
  });
  const assurance = await evaluateDestinationAssurance({
    workspaceId: params.workspaceId,
    entryId: entry.id,
    versionId: version.id,
    schema,
    data: version.data_jsonb,
    locale: version.locale,
  });
  const results = [...baseResults, ...assurance.results];
  const summary = {
    blocking: results.filter((item) => item.status === "fail").length,
    warnings: results.filter((item) => item.status === "warning").length,
    passed: results.filter((item) => item.status === "pass").length,
  };
  return {
    entryId: entry.id,
    versionId: version.id,
    status: summary.blocking ? "blocked" : "ready",
    summary,
    results,
    destinations: assurance.destinations,
    toolingBoundary: assurance.toolingBoundary,
  };
}

export async function runEntryPreflight(workspaceId: string, entryId: string): Promise<PreflightReport | null> {
  const entry = await getEntry(workspaceId, entryId);
  if (!entry?.current_draft_version_id) return null;
  return evaluateEntryVersion({ workspaceId, entryId, versionId: entry.current_draft_version_id });
}

export async function runVersionPreflight(params: {
  workspaceId: string;
  entryId: string;
  versionId: string;
  coordinatedEntryIds?: string[];
}): Promise<PreflightReport | null> {
  return evaluateEntryVersion(params);
}
