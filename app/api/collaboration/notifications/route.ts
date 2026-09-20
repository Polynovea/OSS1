import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { markEditorialNotificationsRead } from "@/lib/content/collaborationService";

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;

  let body: { notificationIds?: string[]; all?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, data: null, error: "Invalid JSON body", timestamp: new Date().toISOString() }, { status: 400 });
  }

  const result = await markEditorialNotificationsRead({
    workspaceId: auth.data!.actor.workspaceId,
    actorId: auth.data!.actor.adminUserId,
    notificationIds: body.notificationIds,
    all: body.all === true,
  });

  return NextResponse.json(
    { success: result.ok, data: result.ok ? result.data : null, error: result.ok ? null : result.error, timestamp: new Date().toISOString() },
    { status: result.ok ? 200 : result.status },
  );
}
