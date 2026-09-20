import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { listWebhookDeliveries, listWebhookSubscriptions } from "@/lib/content/webhookService";

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  try {
    const subscriptionId = new URL(req.url).searchParams.get("subscriptionId") || undefined;
    const [subscriptions, deliveries] = await Promise.all([
      listWebhookSubscriptions(auth.data!.actor.workspaceId),
      listWebhookDeliveries(auth.data!.actor.workspaceId, subscriptionId),
    ]);
    return NextResponse.json({ success: true, data: { subscriptions, deliveries }, error: null, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ success: false, data: null, error: error instanceof Error ? error.message : "Could not load webhook operations", timestamp: new Date().toISOString() }, { status: 400 });
  }
}
