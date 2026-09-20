import { NextResponse } from "next/server";
import { requirePlatformAccess, hasPermission } from "@/lib/platform/permissions";
import { getWorkflow, transitionWorkflow } from "@/lib/content/workflowService";
import { getEntry } from "@/lib/content/entryService";
import { canActorOperateEntry } from "@/lib/schema/modelAccess";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  const { id } = await params;
  const access = await canActorOperateEntry(auth.data!.actor, id, "read");
  if (!access.allowed) return NextResponse.json({ success: false, data: null, error: access.error, timestamp: new Date().toISOString() }, { status: access.status });
  const entry = await getEntry(auth.data!.actor.workspaceId, id);
  if (!entry) return NextResponse.json({ success: false, data: null, error: "Entry not found", timestamp: new Date().toISOString() }, { status: 404 });
  return NextResponse.json({ success: true, data: { workflow: await getWorkflow(id), entryStatus: entry.status }, error: null, timestamp: new Date().toISOString() });
}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) { const auth = await requirePlatformAccess(req, { permission: "content.entry.edit" }); if (auth.error) return auth.error; try { const { id } = await params; const body = await req.json(); const operation = body.action === "approve" || body.action === "request_changes" ? "publish" : "edit"; const access = await canActorOperateEntry(auth.data!.actor, id, operation); if (!access.allowed) return NextResponse.json({ success: false, data: null, error: access.error, timestamp: new Date().toISOString() }, { status: access.status }); const result = await transitionWorkflow({ workspaceId: auth.data!.actor.workspaceId, entryId: id, actorId: auth.data!.actor.adminUserId, action: body.action, comment: body.comment, canPublish: hasPermission(auth.data!.actor, "content.entry.publish") }); return NextResponse.json({ success: result.ok, data: result.ok ? result.data : null, error: result.ok ? null : result.error, timestamp: new Date().toISOString() }, { status: result.ok ? 200 : result.status }); } catch (error) { return NextResponse.json({ success: false, data: null, error: error instanceof Error ? error.message : "Invalid workflow request", timestamp: new Date().toISOString() }, { status: 400 }); } }
