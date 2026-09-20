import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getCommandCenterSnapshot } from "@/lib/admin/commandCenterService";

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "workspace.read" });
  if (auth.error) return auth.error;

  try {
    const data = await getCommandCenterSnapshot(auth.data!.actor.workspaceId, auth.data!.actor.adminUserId);
    return Response.json({ success: true, data, error: null, timestamp: new Date().toISOString() });
  } catch (error) {
    return Response.json(
      { success: false, data: null, error: error instanceof Error ? error.message : "Could not load command center", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
