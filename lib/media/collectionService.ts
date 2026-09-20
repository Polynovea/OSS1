import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";
import { AssetRow } from "@/lib/media/assetService";

export interface MediaCollectionRow {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_collection_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  children?: MediaCollectionRow[];
  assetCount?: number;
}

export async function listCollections(workspaceId: string): Promise<MediaCollectionRow[]> {
  const db = createServiceRoleClient();
  const [colsRes, countRes] = await Promise.all([
    db.from("media_collections").select("*").eq("workspace_id", workspaceId).order("name", { ascending: true }),
    db.from("media_collection_assets").select("collection_id").eq("workspace_id", workspaceId),
  ]);

  const collections = (colsRes.data as MediaCollectionRow[]) ?? [];
  const counts = new Map<string, number>();
  for (const c of (countRes.data ?? [])) {
    counts.set(c.collection_id, (counts.get(c.collection_id) || 0) + 1);
  }

  const colMap = new Map<string, MediaCollectionRow>();
  for (const c of collections) {
    c.assetCount = counts.get(c.id) || 0;
    c.children = [];
    colMap.set(c.id, c);
  }

  const rootCollections: MediaCollectionRow[] = [];
  for (const c of collections) {
    if (c.parent_collection_id && colMap.has(c.parent_collection_id)) {
      colMap.get(c.parent_collection_id)!.children!.push(c);
    } else {
      rootCollections.push(c);
    }
  }

  return rootCollections;
}

export async function getCollection(workspaceId: string, id: string): Promise<MediaCollectionRow | null> {
  const { data } = await createServiceRoleClient()
    .from("media_collections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  return (data as MediaCollectionRow) ?? null;
}

export async function createCollection(params: {
  workspaceId: string;
  actorAdminUserId: string;
  name: string;
  slug: string;
  description?: string | null;
  parentCollectionId?: string | null;
}): Promise<MediaCollectionRow> {
  const db = createServiceRoleClient();
  const slug = params.slug.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "-");

  const { data, error } = await db
    .from("media_collections")
    .insert({
      workspace_id: params.workspaceId,
      name: params.name.trim(),
      slug,
      description: params.description?.trim() || null,
      parent_collection_id: params.parentCollectionId || null,
      created_by: params.actorAdminUserId,
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || "Could not create media collection");

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: "media.collection.created",
    entityType: "media_collection",
    entityId: data.id,
    metadata: { name: data.name, slug: data.slug },
  });

  return data as MediaCollectionRow;
}

export async function updateCollection(params: {
  workspaceId: string;
  actorAdminUserId: string;
  id: string;
  name?: string;
  description?: string | null;
  parentCollectionId?: string | null;
}): Promise<MediaCollectionRow> {
  const db = createServiceRoleClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.name !== undefined) updates.name = params.name.trim();
  if (params.description !== undefined) updates.description = params.description?.trim() || null;
  if (params.parentCollectionId !== undefined) updates.parent_collection_id = params.parentCollectionId;

  const { data, error } = await db
    .from("media_collections")
    .update(updates)
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.id)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || "Could not update media collection");

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: "media.collection.updated",
    entityType: "media_collection",
    entityId: data.id,
    metadata: updates,
  });

  return data as MediaCollectionRow;
}

export async function deleteCollection(params: {
  workspaceId: string;
  actorAdminUserId: string;
  id: string;
}): Promise<{ ok: true }> {
  const db = createServiceRoleClient();
  const { error } = await db
    .from("media_collections")
    .delete()
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.id);

  if (error) throw new Error(error.message);

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: "media.collection.deleted",
    entityType: "media_collection",
    entityId: params.id,
    metadata: {},
  });

  return { ok: true };
}

export async function addAssetToCollection(params: {
  workspaceId: string;
  collectionId: string;
  assetId: string;
  position?: number;
}): Promise<{ ok: true }> {
  const db = createServiceRoleClient();
  const { error } = await db.from("media_collection_assets").upsert(
    {
      workspace_id: params.workspaceId,
      collection_id: params.collectionId,
      asset_id: params.assetId,
      position: params.position ?? 0,
    },
    { onConflict: "collection_id,asset_id" }
  );

  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function removeAssetFromCollection(params: {
  workspaceId: string;
  collectionId: string;
  assetId: string;
}): Promise<{ ok: true }> {
  const db = createServiceRoleClient();
  const { error } = await db
    .from("media_collection_assets")
    .delete()
    .eq("workspace_id", params.workspaceId)
    .eq("collection_id", params.collectionId)
    .eq("asset_id", params.assetId);

  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function listCollectionAssets(workspaceId: string, collectionId: string): Promise<AssetRow[]> {
  const db = createServiceRoleClient();
  const { data } = await db
    .from("media_collection_assets")
    .select("assets(*)")
    .eq("workspace_id", workspaceId)
    .eq("collection_id", collectionId)
    .order("position", { ascending: true });

  return (data ?? []).map((row: any) => row.assets).filter(Boolean);
}
