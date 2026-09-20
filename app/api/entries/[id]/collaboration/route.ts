import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { addComment, assignEntry, getEntryCollaboration, resolveComment, setWatch } from "@/lib/content/collaborationService";
import { canActorOperateEntry } from "@/lib/schema/modelAccess";

const respond = (result: { ok: boolean; data?: unknown; error?: string; status?: number }) => NextResponse.json({ success: result.ok, data: result.ok ? result.data : null, error: result.ok ? null : result.error, timestamp: new Date().toISOString() }, { status: result.ok ? 200 : result.status });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) { const auth = await requirePlatformAccess(req, { permission: "content.entry.read" }); if (auth.error) return auth.error; const { id } = await params; const access = await canActorOperateEntry(auth.data!.actor, id, "read"); if (!access.allowed) return NextResponse.json({ success: false, data: null, error: access.error, timestamp: new Date().toISOString() }, { status: access.status }); return respond(await getEntryCollaboration(auth.data!.actor.workspaceId, id)); }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.edit" }); if (auth.error) return auth.error;
  try { const { id } = await params; const access = await canActorOperateEntry(auth.data!.actor, id, "edit"); if (!access.allowed) return NextResponse.json({ success: false, data: null, error: access.error, timestamp: new Date().toISOString() }, { status: access.status }); const body = await req.json(); const base = { workspaceId: auth.data!.actor.workspaceId, entryId: id, actorId: auth.data!.actor.adminUserId };
    if (body.action === "assign") return respond(await assignEntry({ ...base, assigneeId: body.assigneeId, role: body.role, dueAt: body.dueAt, note: body.note }));
    if (body.action === "comment") return respond(await addComment({ ...base, body: body.body, parentCommentId: body.parentCommentId, mentionIds: body.mentionIds }));
    if (body.action === "resolve_comment") return respond(await resolveComment({ ...base, commentId: body.commentId }));
    if (body.action === "watch") return respond(await setWatch({ ...base, watching: Boolean(body.watching) }));
    return NextResponse.json({ success: false, data: null, error: "Unsupported collaboration action", timestamp: new Date().toISOString() }, { status: 400 });
  } catch (error) { return NextResponse.json({ success: false, data: null, error: error instanceof Error ? error.message : "Invalid collaboration request", timestamp: new Date().toISOString() }, { status: 400 }); }
}
