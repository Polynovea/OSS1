import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { updateRemediationTask } from "@/lib/content/healthService";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: ["content.entry.edit", "workspace.manage"] });
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const body = await req.json();
    const data = await updateRemediationTask({
      workspaceId: auth.data!.actor.workspaceId,
      actorId: auth.data!.actor.adminUserId,
      id,
      status: body.status !== undefined ? String(body.status) : undefined,
      priority: body.priority !== undefined ? String(body.priority) : undefined,
      assignedTo: body.assignedTo !== undefined ? (body.assignedTo ? String(body.assignedTo) : null) : undefined,
      dueAt: body.dueAt !== undefined ? (body.dueAt ? String(body.dueAt) : null) : undefined,
      resolutionNote: body.resolutionNote !== undefined ? (body.resolutionNote ? String(body.resolutionNote) : null) : undefined,
    });
    return NextResponse.json({ success: true, data, error: null });
  } catch (error) {
    return NextResponse.json({ success: false, data: null, error: error instanceof Error ? error.message : "Could not update remediation task" }, { status: 400 });
  }
}
