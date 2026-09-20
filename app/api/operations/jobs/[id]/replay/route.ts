import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { replayDeliveryJob } from "@/lib/operations/deliveryJobService";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.publish" });
  if (auth.error) return auth.error;
  const { id } = await params;
  try {
    const data = await replayDeliveryJob({ workspaceId: auth.data!.actor.workspaceId, actorId: auth.data!.actor.adminUserId, jobId: id });
    return NextResponse.json({ success: true, data, error: null, timestamp: new Date().toISOString() }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, data: null, error: error instanceof Error ? error.message : "Could not replay delivery job", timestamp: new Date().toISOString() }, { status: 400 });
  }
}
