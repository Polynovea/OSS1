import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { unarchiveEntry } from "@/lib/content/entryService";
import { canActorOperateEntry } from "@/lib/schema/modelAccess";

const response = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.archive" });
  if (auth.error) return auth.error;
  const { id } = await params;
  const access = await canActorOperateEntry(auth.data!.actor, id, "archive");
  if (!access.allowed) return response(false, null, access.error, access.status);
  const result = await unarchiveEntry({ workspaceId: auth.data!.actor.workspaceId, entryId: id, actorAdminUserId: auth.data!.actor.adminUserId });
  return result.ok ? response(true, result.data, null) : response(false, null, result.error, result.status);
}
