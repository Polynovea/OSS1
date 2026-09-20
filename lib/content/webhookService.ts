import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { decryptConfig, encryptConfig } from "@/lib/content/secureConfig";
import { enqueueDeliveryJob } from "@/lib/operations/deliveryJobService";
import { logPlatformEvent } from "@/lib/platform/audit";
import { assertSafeOutboundUrl } from "@/lib/infrastructure/networkSafety";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const retryAt = (attempt: number) => new Date(Date.now() + Math.min(3_600_000, 1_000 * 2 ** attempt)).toISOString();

export async function createWebhookSubscription(params: {
  workspaceId: string;
  actorId: string;
  name: string;
  endpointUrl: string;
  eventFilters: string[];
}) {
  if (!params.name.trim()) {
    throw new Error("A name and HTTPS endpoint are required");
  }
  await assertSafeOutboundUrl(params.endpointUrl, "production");
  const secret = randomBytes(32).toString("base64url");
  const { data, error } = await createServiceRoleClient()
    .from("webhook_subscriptions")
    .insert({
      workspace_id: params.workspaceId,
      name: params.name.trim(),
      endpoint_url: params.endpointUrl,
      event_filters: params.eventFilters,
      signing_secret_hash: hash(secret),
      signing_secret_encrypted: encryptConfig({ secret }),
      created_by: params.actorId,
    })
    .select("id, name, endpoint_url, event_filters, active, created_at")
    .single();
  if (error || !data) throw new Error(error?.message || "Could not create webhook subscription");
  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorId,
    action: "webhook.subscription_created",
    entityType: "webhook_subscription",
    entityId: data.id,
  });
  return { subscription: data, signingSecret: secret };
}

export async function listWebhookSubscriptions(workspaceId: string) {
  const { data } = await createServiceRoleClient()
    .from("webhook_subscriptions")
    .select("id, name, endpoint_url, event_filters, active, consecutive_failures, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function listWebhookDeliveries(workspaceId: string, subscriptionId?: string) {
  let query = createServiceRoleClient()
    .from("webhook_deliveries")
    .select("*, webhook_subscriptions!inner(id, workspace_id, name, endpoint_url, active)")
    .eq("webhook_subscriptions.workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (subscriptionId) query = query.eq("subscription_id", subscriptionId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function setWebhookSubscriptionActive(params: {
  workspaceId: string;
  actorId: string;
  subscriptionId: string;
  active: boolean;
}) {
  const { data, error } = await createServiceRoleClient()
    .from("webhook_subscriptions")
    .update({ active: params.active, updated_at: new Date().toISOString(), consecutive_failures: params.active ? 0 : undefined })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.subscriptionId)
    .select("id, name, endpoint_url, event_filters, active, consecutive_failures, updated_at")
    .single();
  if (error || !data) throw new Error(error?.message || "Webhook subscription not found");
  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorId,
    action: params.active ? "webhook.subscription_enabled" : "webhook.subscription_disabled",
    entityType: "webhook_subscription",
    entityId: params.subscriptionId,
  });
  return data;
}

export async function rotateWebhookSecret(params: { workspaceId: string; actorId: string; subscriptionId: string }) {
  const secret = randomBytes(32).toString("base64url");
  const { data, error } = await createServiceRoleClient()
    .from("webhook_subscriptions")
    .update({
      signing_secret_hash: hash(secret),
      signing_secret_encrypted: encryptConfig({ secret }),
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.subscriptionId)
    .select("id, name, endpoint_url, active, updated_at")
    .single();
  if (error || !data) throw new Error(error?.message || "Webhook subscription not found");
  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorId,
    action: "webhook.secret_rotated",
    entityType: "webhook_subscription",
    entityId: params.subscriptionId,
  });
  return { subscription: data, signingSecret: secret };
}

export async function queueWebhookEvent(params: {
  workspaceId: string;
  eventType: string;
  eventId: string;
  payload: Record<string, unknown>;
}) {
  const db = createServiceRoleClient();
  const { data: subscriptions } = await db
    .from("webhook_subscriptions")
    .select("id, event_filters")
    .eq("workspace_id", params.workspaceId)
    .eq("active", true);
  const correlationId = randomUUID();
  await Promise.all(
    (subscriptions ?? [])
      .filter((item) => item.event_filters.length === 0 || item.event_filters.includes(params.eventType) || item.event_filters.includes("*"))
      .map(async (item) => {
        const { data: delivery, error } = await db
          .from("webhook_deliveries")
          .insert({
            subscription_id: item.id,
            event_type: params.eventType,
            event_id: params.eventId,
            payload_json: params.payload,
          })
          .select("id")
          .single();
        if (error?.code === "23505") return;
        if (error || !delivery) throw new Error(error?.message || "Could not queue webhook delivery");
        await enqueueDeliveryJob({
          workspaceId: params.workspaceId,
          kind: "webhook",
          idempotencyKey: `webhook-delivery:${delivery.id}`,
          correlationId,
          payload: { webhookDeliveryId: delivery.id },
          safeMetadata: {
            webhookDeliveryId: delivery.id,
            subscriptionId: item.id,
            eventType: params.eventType,
            eventId: params.eventId,
          },
        });
      })
  );
}

/** Compatibility dispatcher; Phase 10's external worker owns normal execution. */
export async function dispatchWebhookDelivery(deliveryId: string) {
  const db = createServiceRoleClient();
  const { data: delivery } = await db
    .from("webhook_deliveries")
    .select("*, webhook_subscriptions!inner(workspace_id, endpoint_url, signing_secret_encrypted, active)")
    .eq("id", deliveryId)
    .maybeSingle();
  if (!delivery || !delivery.webhook_subscriptions?.active || delivery.status === "succeeded") return null;

  const attempt = delivery.attempt_count + 1;
  const startedAt = Date.now();
  const payload = JSON.stringify({
    id: delivery.event_id,
    type: delivery.event_type,
    occurredAt: new Date().toISOString(),
    data: delivery.payload_json,
  });
  await db.from("webhook_deliveries").update({ status: "running", attempt_count: attempt }).eq("id", delivery.id);

  try {
    const { secret } = decryptConfig<{ secret: string }>(delivery.webhook_subscriptions.signing_secret_encrypted);
    await assertSafeOutboundUrl(delivery.webhook_subscriptions.endpoint_url, "production");
    const response = await fetch(delivery.webhook_subscriptions.endpoint_url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-polynovea-event": delivery.event_type,
        "x-polynovea-delivery": delivery.id,
        "x-polynovea-signature": `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    const success = response.ok;
    const status = success ? "succeeded" : attempt >= 5 ? "failed" : "queued";
    await db
      .from("webhook_deliveries")
      .update({
        status,
        response_status: response.status,
        completed_at: success ? new Date().toISOString() : null,
        next_attempt_at: success ? null : retryAt(attempt),
        last_error: success ? null : `Endpoint returned ${response.status}`,
      })
      .eq("id", delivery.id);
    if (!success) {
      await db.from("webhook_subscriptions").update({ consecutive_failures: attempt, active: attempt < 5 }).eq("id", delivery.subscription_id);
    } else {
      await db.from("webhook_subscriptions").update({ consecutive_failures: 0 }).eq("id", delivery.subscription_id);
    }
    await db.rpc("cms_record_destination_health", {
      p_workspace_id: delivery.webhook_subscriptions.workspace_id,
      p_destination_kind: "webhook_subscription",
      p_destination_id: delivery.subscription_id,
      p_success: success,
      p_latency_ms: Date.now() - startedAt,
      p_error_code: success ? null : `HTTP_${response.status}`,
      p_error_message: success ? null : `Endpoint returned ${response.status}`,
      p_disabled: !success && attempt >= 5,
    });
    return { ...delivery, status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook delivery failed";
    const status = attempt >= 5 ? "failed" : "queued";
    await db
      .from("webhook_deliveries")
      .update({ status, next_attempt_at: retryAt(attempt), last_error: message })
      .eq("id", delivery.id);
    await db.from("webhook_subscriptions").update({ consecutive_failures: attempt, active: attempt < 5 }).eq("id", delivery.subscription_id);
    await db.rpc("cms_record_destination_health", {
      p_workspace_id: delivery.webhook_subscriptions.workspace_id,
      p_destination_kind: "webhook_subscription",
      p_destination_id: delivery.subscription_id,
      p_success: false,
      p_latency_ms: Date.now() - startedAt,
      p_error_code: "NETWORK_ERROR",
      p_error_message: message,
      p_disabled: attempt >= 5,
    });
    return { ...delivery, status };
  }
}
