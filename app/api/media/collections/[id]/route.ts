import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getCollection, updateCollection, deleteCollection, listCollectionAssets, addAssetToCollection, removeAssetFromCollection } from "@/lib/media/collectionService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "media.read" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const collection = await getCollection(auth.data!.actor.workspaceId, id);
  if (!collection) return respond(false, null, "Media collection not found", 404);

  const assets = await listCollectionAssets(auth.data!.actor.workspaceId, id);
  return respond(true, { collection, assets }, null);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "media.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    const body = await req.json();

    // If adding or removing asset membership
    if (body.action === "add_asset" && body.assetId) {
      await addAssetToCollection({
        workspaceId: auth.data!.actor.workspaceId,
        collectionId: id,
        assetId: body.assetId,
        position: body.position,
      });
      return respond(true, { ok: true }, null);
    }

    if (body.action === "remove_asset" && body.assetId) {
      await removeAssetFromCollection({
        workspaceId: auth.data!.actor.workspaceId,
        collectionId: id,
        assetId: body.assetId,
      });
      return respond(true, { ok: true }, null);
    }

    const updated = await updateCollection({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      id,
      name: body.name,
      description: body.description,
      parentCollectionId: body.parentCollectionId,
    });

    return respond(true, updated, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not update collection", 400);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "media.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    await deleteCollection({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      id,
    });
    return respond(true, { ok: true }, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not delete collection", 400);
  }
}
