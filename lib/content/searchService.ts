import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import type { ContentEntryRow, ContentEntryVersionRow } from "@/lib/content/entryService";

export function searchableText(data: Record<string, unknown>) {
  const title = typeof data.title === "string" ? [data.title] : [];
  return [...title, ...Object.entries(data)
    .filter(([key]) => key !== "title")
    .flatMap(([, value]) => typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])]
    .join(" ").replace(/\s+/g, " ").trim();
}

export async function indexEntry(entry: ContentEntryRow, version: ContentEntryVersionRow) {
  await createServiceRoleClient().from("content_search_documents").upsert({
    entry_id: entry.id,
    workspace_id: entry.workspace_id,
    version_id: version.id,
    content_model_id: entry.content_model_id,
    locale: version.locale,
    status: entry.status,
    author_id: entry.created_by,
    search_text: searchableText(version.data_jsonb),
    updated_at: new Date().toISOString(),
  }, { onConflict: "entry_id" });
}

export interface ContentSearchParams {
  workspaceId: string;
  query?: string;
  modelId?: string;
  status?: string;
  locale?: string;
  authorId?: string;
  updatedFrom?: string;
  updatedTo?: string;
  termId?: string;
  sort?: "relevance" | "updated_desc" | "updated_asc";
  limit?: number;
  offset?: number;
}

export async function searchContent(params: ContentSearchParams) {
  const db = createServiceRoleClient();
  const { data, error } = await db.rpc("cms_search_content_ranked", {
    p_workspace_id: params.workspaceId,
    p_query: params.query?.trim() || null,
    p_model_id: params.modelId ?? null,
    p_status: params.status ?? null,
    p_locale: params.locale ?? null,
    p_author_id: params.authorId ?? null,
    p_updated_from: params.updatedFrom ?? null,
    p_updated_to: params.updatedTo ?? null,
    p_term_id: params.termId ?? null,
    p_limit: Math.min(200, Math.max(1, params.limit ?? 50)),
    p_offset: Math.max(0, params.offset ?? 0),
  });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (params.sort === "updated_asc") return [...rows].sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
  if (params.sort === "updated_desc") return [...rows].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  return rows;
}

export async function listSavedSearches(workspaceId: string, ownerId: string) {
  const { data, error } = await createServiceRoleClient()
    .from("content_saved_searches")
    .select("*")
    .eq("workspace_id", workspaceId)
    .or(`owner_id.eq.${ownerId},is_shared.eq.true`)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function saveSearch(params: { workspaceId: string; ownerId: string; name: string; query: Record<string, unknown>; shared?: boolean }) {
  if (!params.name.trim()) throw new Error("Saved search name is required");
  const { data, error } = await createServiceRoleClient()
    .from("content_saved_searches")
    .upsert({
      workspace_id: params.workspaceId,
      owner_id: params.ownerId,
      name: params.name.trim(),
      query_json: params.query,
      is_shared: Boolean(params.shared),
      updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id,owner_id,name" })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message || "Could not save search");
  return data;
}

export async function deleteSavedSearch(params: { workspaceId: string; ownerId: string; id: string }) {
  const { data, error } = await createServiceRoleClient()
    .from("content_saved_searches")
    .delete()
    .eq("workspace_id", params.workspaceId)
    .eq("owner_id", params.ownerId)
    .eq("id", params.id)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Saved search not found or not owned by this actor");
  return data;
}
