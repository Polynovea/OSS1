import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { rotateWebhookSecret, setWebhookSubscriptionActive } from "@/lib/content/webhookService";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.publish" });
  if (auth.error) return auth.error;
  const { id } = await params;
  try {
    const body = await req.json();
    if (body.operation === "rotate_secret") {
      const data = await rotateWebhookSecret({ workspaceId: auth.data!.actor.workspaceId, actorId: auth.data!.actor.adminUserId, subscriptionId: id });
      return NextResponse.json({ success: true, data, error: null, timestamp: new Date().toISOString() });
    }
    if (body.operation === "set_active") {
      const data = await setWebhookSubscriptionActive({ workspaceId: auth.data!.actor.workspaceId, actorId: auth.data!.actor.adminUserId, subscriptionId: id, active: body.active === true });
      return NextResponse.json({ success: true, data, error: null, timestamp: new Date().toISOString() });
    }
    return NextResponse.json({ success: false, data: null, error: "operation must be rotate_secret or set_active", timestamp: new Date().toISOString() }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, data: null, error: error instanceof Error ? error.message : "Could not update webhook subscription", timestamp: new Date().toISOString() }, { status: 400 });
  }
}
