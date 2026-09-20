import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { createRelease, listReleases } from "@/lib/content/releaseService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  try {
    return respond(true, await listReleases(auth.data!.actor.workspaceId), null);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Could not load releases", 500);
  }
}

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.publish" });
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const result = await createRelease({
      workspaceId: auth.data!.actor.workspaceId,
      actorId: auth.data!.actor.adminUserId,
      name: body.name,
      description: body.description,
      itemVersionIds: Array.isArray(body.itemVersionIds) ? body.itemVersionIds : [],
      locales: Array.isArray(body.locales) ? body.locales : [],
    });
    return result.ok ? respond(true, result.data, null, 201) : respond(false, null, result.error, result.status);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Invalid release request", 400);
  }
}
