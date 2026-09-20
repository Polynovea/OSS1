import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { processDueReleases } from "@/lib/content/releaseService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

/**
 * Phase 8 execution hook for due scheduled releases.
 * A durable external worker/queue that calls this safely is Phase 10; the CMS
 * mutation itself is already transactional and idempotent-by-state.
 */
export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.publish" });
  if (auth.error) return auth.error;
  try {
    const body = await req.json().catch(() => ({}));
    const data = await processDueReleases({
      workspaceId: auth.data!.actor.workspaceId,
      actorId: auth.data!.actor.adminUserId,
      limit: typeof body.limit === "number" ? body.limit : 10,
    });
    return respond(true, data, null);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Could not process due releases", 500);
  }
}
