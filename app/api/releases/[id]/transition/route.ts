import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { transitionRelease } from "@/lib/content/releaseService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });
const ACTIONS = ["approve", "request_changes", "schedule", "cancel"] as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.publish" });
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    if (!ACTIONS.includes(body.action)) return respond(false, null, `action must be one of: ${ACTIONS.join(", ")}`, 400);
    const { id } = await params;
    const result = await transitionRelease({
      workspaceId: auth.data!.actor.workspaceId,
      actorId: auth.data!.actor.adminUserId,
      releaseId: id,
      action: body.action,
      scheduledFor: body.scheduledFor ?? null,
      comment: body.comment ?? null,
    });
    return result.ok ? respond(true, result.data, null) : respond(false, null, result.error, result.status);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Release transition failed", 400);
  }
}
