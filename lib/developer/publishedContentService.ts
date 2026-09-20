import { createServiceRoleClient } from "@/lib/admin/serviceRole";

export interface PublishedContentRecord {
  id: string;
  model: string;
  locale: string;
  versionId: string;
  version: number;
  publishedAt: string;
  updatedAt: string;
  data: Record<string, unknown>;
  route: { path: string; locale: string } | null;
}

async function resolveModel(workspaceId: string, apiKey: string) {
  const { data, error } = await createServiceRoleClient()
    .from("content_models")
    .select("id, api_key, name, status")
    .eq("workspace_id", workspaceId)
    .eq("api_key", apiKey)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function listPublishedContent(params: { workspaceId: string; modelApiKey: string; locale?: string; limit?: number; offset?: number }) {
  const model = await resolveModel(params.workspaceId, params.modelApiKey);
  if (!model) return { model: null, records: [] as PublishedContentRecord[] };
  const limit = Math.min(100, Math.max(1, params.limit ?? 25));
  const offset = Math.max(0, params.offset ?? 0);
  const db = createServiceRoleClient();
  let entryQuery = db
    .from("content_entries")
    .select("id, published_version_id, updated_at")
    .eq("workspace_id", params.workspaceId)
    .eq("content_model_id", model.id)
    .eq("status", "published")
    .not("published_version_id", "is", null)
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);
  const { data: entries, error } = await entryQuery;
  if (error) throw new Error(error.message);
  const versionIds = (entries ?? []).map((entry) => entry.published_version_id).filter((id): id is string => Boolean(id));
  if (!versionIds.length) return { model, records: [] as PublishedContentRecord[] };
  let versionQuery = db
    .from("content_entry_versions")
    .select("id, entry_id, version_number, data_jsonb, locale, created_at")
    .in("id", versionIds);
  if (params.locale) versionQuery = versionQuery.eq("locale", params.locale);
  const [{ data: versions, error: versionError }, { data: routes }] = await Promise.all([
    versionQuery,
    db.from("content_routes").select("entry_id, path, locale").eq("workspace_id", params.workspaceId).eq("is_canonical", true).eq("status", "active"),
  ]);
  if (versionError) throw new Error(versionError.message);
  const entryById = new Map((entries ?? []).map((entry) => [entry.id, entry]));
  const routeByEntryLocale = new Map((routes ?? []).map((route) => [`${route.entry_id}:${route.locale}`, route]));
  const records = (versions ?? []).map((version) => {
    const entry = entryById.get(version.entry_id)!;
    const route = routeByEntryLocale.get(`${version.entry_id}:${version.locale}`) ?? null;
    return {
      id: version.entry_id,
      model: model.api_key,
      locale: version.locale,
      versionId: version.id,
      version: version.version_number,
      publishedAt: version.created_at,
      updatedAt: entry.updated_at,
      data: version.data_jsonb as Record<string, unknown>,
      route: route ? { path: route.path, locale: route.locale } : null,
    } satisfies PublishedContentRecord;
  });
  return { model, records };
}

export async function getPublishedContent(params: { workspaceId: string; modelApiKey: string; entryId: string; locale?: string }) {
  const model = await resolveModel(params.workspaceId, params.modelApiKey);
  if (!model) return { model: null, record: null as PublishedContentRecord | null };
  const db = createServiceRoleClient();
  const { data: entry, error } = await db
    .from("content_entries")
    .select("id, published_version_id, updated_at")
    .eq("workspace_id", params.workspaceId)
    .eq("content_model_id", model.id)
    .eq("status", "published")
    .eq("id", params.entryId)
    .not("published_version_id", "is", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!entry?.published_version_id) return { model, record: null as PublishedContentRecord | null };
  let versionQuery = db.from("content_entry_versions").select("id, entry_id, version_number, data_jsonb, locale, created_at").eq("id", entry.published_version_id);
  if (params.locale) versionQuery = versionQuery.eq("locale", params.locale);
  const { data: version, error: versionError } = await versionQuery.maybeSingle();
  if (versionError) throw new Error(versionError.message);
  if (!version) return { model, record: null as PublishedContentRecord | null };
  const { data: route } = await db
    .from("content_routes")
    .select("path, locale")
    .eq("workspace_id", params.workspaceId)
    .eq("entry_id", entry.id)
    .eq("locale", version.locale)
    .eq("is_canonical", true)
    .eq("status", "active")
    .maybeSingle();
  return {
    model,
    record: {
      id: entry.id,
      model: model.api_key,
      locale: version.locale,
      versionId: version.id,
      version: version.version_number,
      publishedAt: version.created_at,
      updatedAt: entry.updated_at,
      data: version.data_jsonb as Record<string, unknown>,
      route: route ? { path: route.path, locale: route.locale } : null,
    } satisfies PublishedContentRecord,
  };
}
