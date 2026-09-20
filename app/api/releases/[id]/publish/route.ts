import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { publishRelease } from "@/lib/content/releaseService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.publish" });
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const result = await publishRelease({
      workspaceId: auth.data!.actor.workspaceId,
      actorId: auth.data!.actor.adminUserId,
      releaseId: id,
    });
    return result.ok ? respond(true, result.data, null) : respond(false, null, result.error, result.status);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Could not publish release", 400);
  }
}
