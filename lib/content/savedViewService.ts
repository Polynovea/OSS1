import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";

export interface SavedEntryViewFilters {
  modelId?: string;
  status?: string;
  query?: string;
  sort?: "updated_desc" | "updated_asc";
}

export interface SavedEntryView {
  id: string;
  workspace_id: string;
  content_model_id: string | null;
  name: string;
  filters_json: SavedEntryViewFilters;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function normalizeFilters(value: unknown): SavedEntryViewFilters {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result: SavedEntryViewFilters = {};
  if (typeof raw.modelId === "string" && raw.modelId) result.modelId = raw.modelId;
  if (typeof raw.status === "string" && raw.status) result.status = raw.status;
  if (typeof raw.query === "string" && raw.query.trim()) result.query = raw.query.trim().slice(0, 200);
  if (raw.sort === "updated_asc" || raw.sort === "updated_desc") result.sort = raw.sort;
  return result;
}

export async function listSavedEntryViews(workspaceId: string, actorAdminUserId: string): Promise<SavedEntryView[]> {
  const { data } = await createServiceRoleClient()
    .from("content_entry_saved_views")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("created_by", actorAdminUserId)
    .order("updated_at", { ascending: false });
  return (data ?? []) as SavedEntryView[];
}

export async function createSavedEntryView(params: { workspaceId: string; actorAdminUserId: string; name: string; filters: unknown }): Promise<{ ok: true; data: SavedEntryView } | { ok: false; error: string; status: number }> {
  const name = params.name.trim();
  if (!name || name.length > 120) return { ok: false, error: "View name must be between 1 and 120 characters", status: 400 };
  const filters = normalizeFilters(params.filters);
  const { data, error } = await createServiceRoleClient().from("content_entry_saved_views").insert({
    workspace_id: params.workspaceId,
    content_model_id: filters.modelId ?? null,
    name,
    filters_json: filters,
    created_by: params.actorAdminUserId,
  }).select().single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save view", status: error?.code === "23505" ? 409 : 500 };
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorAdminUserId, action: "content.entry_view.created", entityType: "content_entry_saved_view", entityId: data.id, afterJson: filters, metadata: { name } });
  return { ok: true, data: data as SavedEntryView };
}

export async function deleteSavedEntryView(params: { workspaceId: string; actorAdminUserId: string; viewId: string }): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const db = createServiceRoleClient();
  const { data: existing } = await db.from("content_entry_saved_views").select("id, name, filters_json").eq("id", params.viewId).eq("workspace_id", params.workspaceId).eq("created_by", params.actorAdminUserId).maybeSingle();
  if (!existing) return { ok: false, error: "Saved view not found", status: 404 };
  const { error } = await db.from("content_entry_saved_views").delete().eq("id", params.viewId).eq("workspace_id", params.workspaceId).eq("created_by", params.actorAdminUserId);
  if (error) return { ok: false, error: "Could not delete saved view", status: 500 };
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorAdminUserId, action: "content.entry_view.deleted", entityType: "content_entry_saved_view", entityId: params.viewId, beforeJson: existing.filters_json, metadata: { name: existing.name } });
  return { ok: true };
}
