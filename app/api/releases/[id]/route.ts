import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getRelease, replaceReleaseItems, setReleaseLocales } from "@/lib/content/releaseService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const release = await getRelease(auth.data!.actor.workspaceId, id);
    return release ? respond(true, release, null) : respond(false, null, "Release not found", 404);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Could not load release", 500);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.publish" });
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const body = await req.json();
    if (body.operation === "replace_items") {
      const result = await replaceReleaseItems({
        workspaceId: auth.data!.actor.workspaceId,
        actorId: auth.data!.actor.adminUserId,
        releaseId: id,
        itemVersionIds: Array.isArray(body.itemVersionIds) ? body.itemVersionIds : [],
      });
      return result.ok ? respond(true, result.data, null) : respond(false, null, result.error, result.status);
    }
    if (body.operation === "set_locales") {
      const result = await setReleaseLocales({
        workspaceId: auth.data!.actor.workspaceId,
        actorId: auth.data!.actor.adminUserId,
        releaseId: id,
        locales: Array.isArray(body.locales) ? body.locales : [],
      });
      return result.ok ? respond(true, result.data, null) : respond(false, null, result.error, result.status);
    }
    return respond(false, null, "operation must be replace_items or set_locales", 400);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Could not update release", 400);
  }
}
