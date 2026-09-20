import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { assignRelease } from "@/lib/content/releaseService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });
const ROLES = ["reviewer", "approver", "publisher"] as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.publish" });
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    if (!body.assigneeId || !ROLES.includes(body.role)) return respond(false, null, "assigneeId and a valid role are required", 400);
    const { id } = await params;
    const result = await assignRelease({
      workspaceId: auth.data!.actor.workspaceId,
      actorId: auth.data!.actor.adminUserId,
      releaseId: id,
      assigneeId: body.assigneeId,
      role: body.role,
      dueAt: body.dueAt ?? null,
      note: body.note ?? null,
    });
    return result.ok ? respond(true, result.data, null) : respond(false, null, result.error, result.status);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Could not assign release", 400);
  }
}
