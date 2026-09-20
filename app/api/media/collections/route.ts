import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { listCollections, createCollection } from "@/lib/media/collectionService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "media.read" });
  if (auth.error) return auth.error;

  try {
    const collections = await listCollections(auth.data!.actor.workspaceId);
    return respond(true, collections, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not list collections", 500);
  }
}

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "media.manage" });
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    if (!body.name || !body.slug) {
      return respond(false, null, "Collection name and slug are required", 400);
    }

    const collection = await createCollection({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      name: body.name,
      slug: body.slug,
      description: body.description,
      parentCollectionId: body.parentCollectionId,
    });

    return respond(true, collection, null, 201);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not create collection", 400);
  }
}
