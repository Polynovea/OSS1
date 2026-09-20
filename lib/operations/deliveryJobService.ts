import { createServiceRoleClient } from "@/lib/admin/serviceRole";

export type DeliveryJobKind =
  | "publish"
  | "scheduled_release"
  | "webhook"
  | "search_index"
  | "image_processing"
  | "health_scan"
  | "analytics_sync";

export type DeliveryJobStatus = "queued" | "running" | "retrying" | "succeeded" | "dead_letter" | "cancelled";

export interface EnqueueDeliveryJobInput {
  workspaceId: string;
  actorId?: string | null;
  kind: DeliveryJobKind;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  safeMetadata?: Record<string, unknown>;
  runAfter?: string;
  priority?: number;
  maxAttempts?: number;
  queueName?: string;
  correlationId?: string | null;
}

export async function enqueueDeliveryJob(input: EnqueueDeliveryJobInput) {
  const { data, error } = await createServiceRoleClient().rpc("cms_enqueue_delivery_job", {
    p_workspace_id: input.workspaceId,
    p_actor_id: input.actorId ?? null,
    p_kind: input.kind,
    p_idempotency_key: input.idempotencyKey,
    p_payload: input.payload ?? {},
    p_safe_metadata: input.safeMetadata ?? {},
    p_run_after: input.runAfter ?? new Date().toISOString(),
    p_priority: input.priority ?? 100,
    p_max_attempts: input.maxAttempts ?? 5,
    p_queue_name: input.queueName ?? "default",
    p_correlation_id: input.correlationId ?? null,
  });
  if (error || !data) throw new Error(error?.message || "Could not enqueue delivery job");
  return data;
}

export async function listDeliveryJobs(params: {
  workspaceId: string;
  status?: DeliveryJobStatus;
  kind?: DeliveryJobKind;
  correlationId?: string;
  limit?: number;
}) {
  let query = createServiceRoleClient()
    .from("delivery_jobs")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .order("created_at", { ascending: false })
    .limit(Math.min(200, Math.max(1, params.limit ?? 100)));
  if (params.status) query = query.eq("status", params.status);
  if (params.kind) query = query.eq("kind", params.kind);
  if (params.correlationId) query = query.eq("correlation_id", params.correlationId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getDeliveryJob(workspaceId: string, jobId: string) {
  const db = createServiceRoleClient();
  const [{ data: job, error }, { data: attempts }, { data: audit }] = await Promise.all([
    db.from("delivery_jobs").select("*").eq("workspace_id", workspaceId).eq("id", jobId).maybeSingle(),
    db.from("delivery_job_attempts").select("*").eq("job_id", jobId).order("attempt_number", { ascending: false }),
    db.from("platform_audit_events")
      .select("id, action, metadata_json, created_at, actor_admin_user_id")
      .eq("workspace_id", workspaceId)
      .eq("entity_type", "delivery_job")
      .eq("entity_id", jobId)
      .order("created_at", { ascending: false }),
  ]);
  if (error) throw new Error(error.message);
  if (!job) return null;
  return { job, attempts: attempts ?? [], audit: audit ?? [] };
}

export async function replayDeliveryJob(params: { workspaceId: string; actorId: string; jobId: string }) {
  const { data, error } = await createServiceRoleClient().rpc("cms_replay_delivery_job", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorId,
    p_job_id: params.jobId,
  });
  if (error || !data) throw new Error(error?.message || "Could not replay delivery job");
  return data;
}

export async function cancelDeliveryJob(params: { workspaceId: string; actorId: string; jobId: string }) {
  const { data, error } = await createServiceRoleClient().rpc("cms_cancel_delivery_job", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorId,
    p_job_id: params.jobId,
  });
  if (error || !data) throw new Error(error?.message || "Could not cancel delivery job");
  return data;
}

export async function listDestinationHealth(workspaceId: string) {
  const { data, error } = await createServiceRoleClient()
    .from("delivery_destination_health")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}
