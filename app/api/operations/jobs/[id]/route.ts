import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getDeliveryJob } from "@/lib/operations/deliveryJobService";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  const { id } = await params;
  try {
    const data = await getDeliveryJob(auth.data!.actor.workspaceId, id);
    if (!data) return NextResponse.json({ success: false, data: null, error: "Delivery job not found", timestamp: new Date().toISOString() }, { status: 404 });
    return NextResponse.json({ success: true, data, error: null, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ success: false, data: null, error: error instanceof Error ? error.message : "Could not load delivery job", timestamp: new Date().toISOString() }, { status: 400 });
  }
}
