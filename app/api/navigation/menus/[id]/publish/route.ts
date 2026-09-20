import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { publishMenu } from "@/lib/navigation/navigationService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "navigation.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const published = await publishMenu({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      menuId: id,
      versionNumber: body.versionNumber,
    });

    return respond(true, published, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not publish navigation menu", 400);
  }
}
