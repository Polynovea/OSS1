import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { runVersionPreflight, type PreflightReport } from "@/lib/content/preflightService";

export type ReleaseStatus = "draft" | "approved" | "scheduled" | "publishing" | "published" | "partially_failed" | "cancelled";
export type ReleaseResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export interface ReleaseReadinessIssue {
  code: string;
  severity: "blocking" | "warning";
  message: string;
  entryId?: string;
  versionId?: string;
  locale?: string;
}

export interface ReleaseReadiness {
  releaseId: string;
  status: "ready" | "blocked";
  summary: { blocking: number; warnings: number; items: number; locales: number };
  issues: ReleaseReadinessIssue[];
  itemReports: Array<{ entryId: string; versionId: string; locale: string; preflight: PreflightReport | null; drifted: boolean }>;
  localeReadiness: Array<{ locale: string; required: boolean; status: "ready" | "blocked"; missingSourceEntryIds: string[] }>;
  rollbackPlan: Array<{ entryId: string; targetVersionId: string; previousPublishedVersionId: string | null }>;
}

interface ReleaseItemShape {
  id: string;
  entry_id: string;
  entry_version_id: string;
  delivery_status: string;
  delivery_error: string | null;
  content_entry_versions?: { id: string; locale: string; version_number: number; state: string; data_jsonb: Record<string, unknown> } | null;
  content_entries?: { id: string; status: string; current_draft_version_id: string | null; published_version_id: string | null; content_model_id: string } | null;
}

const mapRpcError = (error: { message?: string; code?: string } | null | undefined, fallback: string): ReleaseResult<never> => {
  const message = error?.message || fallback;
  const code = error?.code || "";
  if (code === "P0002" || message.includes("not found")) return { ok: false, error: message, status: 404 };
  if (code === "P0003" || message.includes("must") || message.includes("drift") || message.includes("Only ") || message.includes("approved")) return { ok: false, error: message, status: 409 };
  if (code === "22023") return { ok: false, error: message, status: 400 };
  return { ok: false, error: message, status: 500 };
};

export async function listReleases(workspaceId: string) {
  const { data, error } = await createServiceRoleClient()
    .from("releases")
    .select("*, release_items(id,entry_id,entry_version_id,delivery_status,delivery_error), release_locale_targets(locale,required)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getRelease(workspaceId: string, releaseId: string) {
  const { data, error } = await createServiceRoleClient()
    .from("releases")
    .select(`
      *,
      release_items(
        id,entry_id,entry_version_id,delivery_status,delivery_error,created_at,
        content_entries(id,status,current_draft_version_id,published_version_id,content_model_id,content_models!content_entries_workspace_model_fk(name,api_key)),
        content_entry_versions(id,locale,version_number,state,data_jsonb,created_at)
      ),
      release_locale_targets(id,locale,required),
      release_approvals(id,actor_admin_user_id,decision,comment,created_at),
      release_assignments(id,assigned_to_admin_user_id,assigned_by_admin_user_id,role,status,due_at,note,completed_at,created_at),
      release_history(id,actor_admin_user_id,action,from_status,to_status,detail_json,created_at),
      release_rollback_items(entry_id,target_version_id,previous_published_version_id,created_at)
    `)
    .eq("workspace_id", workspaceId)
    .eq("id", releaseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createRelease(params: {
  workspaceId: string;
  actorId: string;
  name: string;
  description?: string;
  itemVersionIds: string[];
  locales?: string[];
}): Promise<ReleaseResult<unknown>> {
  const name = params.name?.trim();
  if (!name) return { ok: false, error: "Release name is required", status: 400 };
  const itemVersionIds = [...new Set(params.itemVersionIds.filter(Boolean))];
  if (!itemVersionIds.length) return { ok: false, error: "A release needs at least one approved entry version", status: 400 };
  const db = createServiceRoleClient();
  // A caller may select optional coordinated locales, but it must never be
  // able to omit a workspace-required locale and thereby bypass readiness.
  const { data: requiredLocaleRows, error: requiredLocalesError } = await db
    .from("workspace_locales")
    .select("locale")
    .eq("workspace_id", params.workspaceId)
    .eq("enabled", true)
    .eq("required", true);
  if (requiredLocalesError) return mapRpcError(requiredLocalesError, "Could not resolve required workspace locales");
  const locales = [...new Set([
    ...(params.locales ?? []).map((locale) => locale.trim()).filter(Boolean),
    ...((requiredLocaleRows ?? []).map((row) => row.locale).filter(Boolean)),
  ])];
  const { data, error } = await db.rpc("cms_create_release", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorId,
    p_name: name,
    p_description: params.description ?? null,
    p_item_version_ids: itemVersionIds,
    p_locales: locales,
  });
  return error || !data ? mapRpcError(error, "Could not create release") : { ok: true, data };
}

export async function replaceReleaseItems(params: { workspaceId: string; actorId: string; releaseId: string; itemVersionIds: string[] }): Promise<ReleaseResult<unknown>> {
  const ids = [...new Set(params.itemVersionIds.filter(Boolean))];
  if (!ids.length) return { ok: false, error: "A release needs at least one approved entry version", status: 400 };
  const { data, error } = await createServiceRoleClient().rpc("cms_replace_release_items", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorId,
    p_release_id: params.releaseId,
    p_item_version_ids: ids,
  });
  return error || !data ? mapRpcError(error, "Could not replace release items") : { ok: true, data };
}

export async function setReleaseLocales(params: { workspaceId: string; actorId: string; releaseId: string; locales: string[] }): Promise<ReleaseResult<unknown>> {
  const { data, error } = await createServiceRoleClient().rpc("cms_set_release_locales", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorId,
    p_release_id: params.releaseId,
    p_locales: [...new Set(params.locales.filter(Boolean))],
  });
  return error || !data ? mapRpcError(error, "Could not update release locales") : { ok: true, data };
}

export async function assignRelease(params: {
  workspaceId: string;
  actorId: string;
  releaseId: string;
  assigneeId: string;
  role: "reviewer" | "approver" | "publisher";
  dueAt?: string | null;
  note?: string | null;
}): Promise<ReleaseResult<unknown>> {
  if (params.dueAt && Number.isNaN(Date.parse(params.dueAt))) return { ok: false, error: "dueAt must be a valid ISO timestamp", status: 400 };
  const { data, error } = await createServiceRoleClient().rpc("cms_assign_release", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorId,
    p_release_id: params.releaseId,
    p_assignee_id: params.assigneeId,
    p_role: params.role,
    p_due_at: params.dueAt ?? null,
    p_note: params.note ?? null,
  });
  return error || !data ? mapRpcError(error, "Could not assign release") : { ok: true, data };
}

export async function getReleaseReadiness(workspaceId: string, releaseId: string): Promise<ReleaseResult<ReleaseReadiness>> {
  const release = await getRelease(workspaceId, releaseId);
  if (!release) return { ok: false, error: "Release not found", status: 404 };
  const items = (release.release_items ?? []) as unknown as ReleaseItemShape[];
  const targetLocales = (release.release_locale_targets ?? []) as Array<{ locale: string; required: boolean }>;
  const issues: ReleaseReadinessIssue[] = [];
  if (!items.length) issues.push({ code: "release.empty", severity: "blocking", message: "Release has no pinned content versions." });

  const coordinatedEntryIds = items.map((item) => item.entry_id);
  const itemReports: ReleaseReadiness["itemReports"] = [];
  for (const item of items) {
    const entry = item.content_entries;
    const version = item.content_entry_versions;
    const drifted = !entry || !version || entry.current_draft_version_id !== item.entry_version_id || entry.status !== "approved";
    if (drifted) {
      issues.push({ code: "release.item_drift", severity: "blocking", message: "Pinned entry changed after it was added to the release. Rebuild or re-approve the release.", entryId: item.entry_id, versionId: item.entry_version_id });
    }
    const preflight = version ? await runVersionPreflight({ workspaceId, entryId: item.entry_id, versionId: item.entry_version_id, coordinatedEntryIds }) : null;
    if (!preflight) {
      issues.push({ code: "release.preflight_unavailable", severity: "blocking", message: "Readiness could not evaluate this pinned version.", entryId: item.entry_id, versionId: item.entry_version_id });
    } else {
      for (const result of preflight.results) {
        if (result.status === "fail") issues.push({ code: `preflight.${result.rule_id}`, severity: "blocking", message: result.message, entryId: item.entry_id, versionId: item.entry_version_id });
        else if (result.status === "warning") issues.push({ code: `preflight.${result.rule_id}`, severity: "warning", message: result.message, entryId: item.entry_id, versionId: item.entry_version_id });
      }
    }
    itemReports.push({ entryId: item.entry_id, versionId: item.entry_version_id, locale: version?.locale ?? "unknown", preflight, drifted });
  }

  const db = createServiceRoleClient();
  const itemEntryIds = new Set(items.map((item) => item.entry_id));
  const itemLocaleByEntry = new Map(items.map((item) => [item.entry_id, item.content_entry_versions?.locale ?? "unknown"]));
  const { data: translationRows } = coordinatedEntryIds.length
    ? await db.from("content_entry_translations").select("source_entry_id,locale,translated_entry_id,source_version_id,reviewed_at,stale_at").eq("workspace_id", workspaceId).in("source_entry_id", coordinatedEntryIds)
    : { data: [] as Array<{ source_entry_id: string; locale: string; translated_entry_id: string | null; source_version_id: string | null; reviewed_at: string | null; stale_at: string | null }> };
  const translatedIds = new Set((translationRows ?? []).map((row) => row.translated_entry_id).filter((id): id is string => Boolean(id)));
  const roots = items.filter((item) => !translatedIds.has(item.entry_id));
  const localeReadiness: ReleaseReadiness["localeReadiness"] = [];

  for (const target of targetLocales) {
    const missingSourceEntryIds: string[] = [];
    for (const root of roots) {
      if (itemLocaleByEntry.get(root.entry_id) === target.locale) continue;
      const relation = (translationRows ?? []).find((row) => row.source_entry_id === root.entry_id && row.locale === target.locale);
      const translatedIncluded = Boolean(relation?.translated_entry_id && itemEntryIds.has(relation.translated_entry_id));
      const sourceVersionCurrent = !relation?.source_version_id || relation.source_version_id === root.entry_version_id;
      const fresh = translatedIncluded && sourceVersionCurrent && !relation?.stale_at && Boolean(relation?.reviewed_at);
      if (!fresh) missingSourceEntryIds.push(root.entry_id);
    }
    const status = missingSourceEntryIds.length && target.required ? "blocked" : "ready";
    localeReadiness.push({ locale: target.locale, required: target.required, status, missingSourceEntryIds });
    if (missingSourceEntryIds.length) {
      issues.push({
        code: target.required ? "localization.required_locale" : "localization.optional_locale",
        severity: target.required ? "blocking" : "warning",
        message: `${target.required ? "Required" : "Selected"} locale ${target.locale} is not current and included for ${missingSourceEntryIds.length} source item${missingSourceEntryIds.length === 1 ? "" : "s"}.`,
        locale: target.locale,
      });
    }
  }

  const { data: dependencyRows } = coordinatedEntryIds.length
    ? await db.from("content_relations").select("source_entry_id,source_version_id,target_entry_id,source_field_key,relation_type").eq("workspace_id", workspaceId).in("source_entry_id", coordinatedEntryIds).not("target_entry_id", "is", null)
    : { data: [] as Array<{ source_entry_id: string | null; source_version_id: string | null; target_entry_id: string | null; source_field_key: string; relation_type: string }> };
  const liveVersionByEntry = new Map(items.map((item) => [item.entry_id, item.entry_version_id]));
  const dependencyTargetIds = [...new Set((dependencyRows ?? []).map((row) => row.target_entry_id).filter((id): id is string => Boolean(id)))];
  const { data: dependencyTargets } = dependencyTargetIds.length
    ? await db.from("content_entries").select("id,status").eq("workspace_id", workspaceId).in("id", dependencyTargetIds)
    : { data: [] as Array<{ id: string; status: string }> };
  const dependencyStatus = new Map((dependencyTargets ?? []).map((row) => [row.id, row.status]));
  for (const edge of dependencyRows ?? []) {
    if (!edge.source_entry_id || liveVersionByEntry.get(edge.source_entry_id) !== edge.source_version_id || !edge.target_entry_id) continue;
    if (itemEntryIds.has(edge.target_entry_id)) continue;
    const status = dependencyStatus.get(edge.target_entry_id);
    if (!status) issues.push({ code: "dependency.missing", severity: "blocking", message: `A dependency from ${edge.source_field_key || "content"} no longer exists.`, entryId: edge.source_entry_id });
    else if (status !== "published") issues.push({ code: "dependency.unpublished", severity: "warning", message: `Dependency ${edge.target_entry_id.slice(0, 8)} is not published and is not part of this release.`, entryId: edge.source_entry_id });
  }

  const rollbackPlan = ((release.release_rollback_items ?? []) as Array<{ entry_id: string; target_version_id: string; previous_published_version_id: string | null }>).map((row) => ({
    entryId: row.entry_id,
    targetVersionId: row.target_version_id,
    previousPublishedVersionId: row.previous_published_version_id,
  }));
  const blocking = issues.filter((issue) => issue.severity === "blocking").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return {
    ok: true,
    data: {
      releaseId,
      status: blocking ? "blocked" : "ready",
      summary: { blocking, warnings, items: items.length, locales: targetLocales.length },
      issues,
      itemReports,
      localeReadiness,
      rollbackPlan,
    },
  };
}

export async function transitionRelease(params: {
  workspaceId: string;
  actorId: string;
  releaseId: string;
  action: "approve" | "request_changes" | "schedule" | "cancel";
  scheduledFor?: string | null;
  comment?: string | null;
}): Promise<ReleaseResult<unknown>> {
  if (params.action === "approve" || params.action === "schedule") {
    const readiness = await getReleaseReadiness(params.workspaceId, params.releaseId);
    if (!readiness.ok) return readiness;
    if (readiness.data.status === "blocked") {
      return { ok: false, error: `Release is blocked by ${readiness.data.summary.blocking} readiness issue${readiness.data.summary.blocking === 1 ? "" : "s"}`, status: 409 };
    }
  }
  if (params.action === "schedule" && (!params.scheduledFor || Number.isNaN(Date.parse(params.scheduledFor)))) {
    return { ok: false, error: "scheduledFor must be a valid future ISO timestamp", status: 400 };
  }
  const { data, error } = await createServiceRoleClient().rpc("cms_transition_release", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorId,
    p_release_id: params.releaseId,
    p_action: params.action,
    p_scheduled_for: params.scheduledFor ?? null,
    p_comment: params.comment ?? null,
  });
  return error || !data ? mapRpcError(error, "Release transition failed") : { ok: true, data };
}

export async function publishRelease(params: { workspaceId: string; actorId: string; releaseId: string }): Promise<ReleaseResult<unknown>> {
  const readiness = await getReleaseReadiness(params.workspaceId, params.releaseId);
  if (!readiness.ok) return readiness;
  if (readiness.data.status === "blocked") return { ok: false, error: `Release is blocked by ${readiness.data.summary.blocking} readiness issue${readiness.data.summary.blocking === 1 ? "" : "s"}`, status: 409 };
  const { data, error } = await createServiceRoleClient().rpc("cms_publish_release", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorId,
    p_release_id: params.releaseId,
  });
  return error || !data ? mapRpcError(error, "Could not publish release") : { ok: true, data };
}

export async function processDueReleases(params: { workspaceId: string; actorId: string; limit?: number }) {
  const limit = Math.min(50, Math.max(1, params.limit ?? 10));
  const { data, error } = await createServiceRoleClient()
    .from("releases")
    .select("id,name,scheduled_for")
    .eq("workspace_id", params.workspaceId)
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  const results = [] as Array<{ releaseId: string; ok: boolean; error?: string }>;
  for (const release of data ?? []) {
    const result = await publishRelease({ workspaceId: params.workspaceId, actorId: params.actorId, releaseId: release.id });
    results.push(result.ok ? { releaseId: release.id, ok: true } : { releaseId: release.id, ok: false, error: result.error });
  }
  return { processed: results.length, succeeded: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results };
}
