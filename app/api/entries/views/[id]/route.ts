import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { deleteSavedEntryView } from "@/lib/content/savedViewService";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  const { id } = await params;
  const result = await deleteSavedEntryView({ workspaceId: auth.data!.actor.workspaceId, actorAdminUserId: auth.data!.actor.adminUserId, viewId: id });
  return NextResponse.json({ success: result.ok, data: result.ok ? { deleted: true } : null, error: result.ok ? null : result.error, timestamp: new Date().toISOString() }, { status: result.ok ? 200 : result.status });
}
