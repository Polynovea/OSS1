import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { revokeDeveloperApiToken } from "@/lib/developer/apiTokenService";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "workspace.manage" });
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const data = await revokeDeveloperApiToken({ workspaceId: auth.data!.actor.workspaceId, actorId: auth.data!.actor.adminUserId, tokenId: id });
    return NextResponse.json({ success: true, data, error: null, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ success: false, data: null, error: error instanceof Error ? error.message : "Could not revoke API token", timestamp: new Date().toISOString() }, { status: 400 });
  }
}
