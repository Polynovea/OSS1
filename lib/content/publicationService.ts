import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { decryptConfig, encryptConfig } from "@/lib/content/secureConfig";
import { enqueueDeliveryJob } from "@/lib/operations/deliveryJobService";
import { logPlatformEvent } from "@/lib/platform/audit";

type TargetConfig = { url: string; headers?: Record<string, string>; signingSecret?: string };

const retryAt = (attempt: number) => new Date(Date.now() + Math.min(3_600_000, 1_000 * 2 ** attempt)).toISOString();

export async function listPublicationTargets(workspaceId: string) {
  const { data } = await createServiceRoleClient()
    .from("publication_targets")
    .select("id, name, target_type, active, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function createPublicationTarget(params: {
  workspaceId: string;
  actorId: string;
  name: string;
  targetType: string;
  config: TargetConfig;
}) {
  if (!params.name.trim() || !/^https:\/\//i.test(params.config.url)) {
    throw new Error("A name and HTTPS destination URL are required");
  }
  const signingSecret = params.config.signingSecret || randomBytes(32).toString("base64url");
  const storedConfig: TargetConfig = { ...params.config, signingSecret };
  const { data, error } = await createServiceRoleClient()
    .from("publication_targets")
    .insert({
      workspace_id: params.workspaceId,
      name: params.name.trim(),
      target_type: params.targetType,
      config_json_encrypted: encryptConfig(storedConfig),
      created_by: params.actorId,
    })
    .select("id, name, target_type, active, created_at")
    .single();
  if (error || !data) throw new Error(error?.message || "Could not create publication target");
  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorId,
    action: "publication.target_created",
    entityType: "publication_target",
    entityId: data.id,
  });
  return { ...data, signingSecret };
}

export async function queueEntryPublication(params: {
  workspaceId: string;
  actorId: string;
  entryId: string;
  versionId: string;
}) {
  const db = createServiceRoleClient();
  const { data: targets } = await db
    .from("publication_targets")
    .select("id")
    .eq("workspace_id", params.workspaceId)
    .eq("active", true);

  const correlationId = randomUUID();
  const jobs = await Promise.all(
    (targets ?? []).map(async (target) => {
      const idempotencyKey = `entry:${params.entryId}:version:${params.versionId}:target:${target.id}`;
      const { data, error } = await db
        .from("publication_jobs")
        .insert({
          workspace_id: params.workspaceId,
          target_id: target.id,
          entry_id: params.entryId,
          version_id: params.versionId,
          idempotency_key: idempotencyKey,
        })
        .select()
        .single();
      if (error?.code === "23505") return null;
      if (error) throw new Error(error.message);

      await enqueueDeliveryJob({
        workspaceId: params.workspaceId,
        actorId: params.actorId,
        kind: "publish",
        idempotencyKey: `publication-job:${data.id}`,
        correlationId,
        payload: { publicationJobId: data.id },
        safeMetadata: {
          publicationJobId: data.id,
          targetId: target.id,
          entryId: params.entryId,
          versionId: params.versionId,
        },
      });
      return data;
    })
  );

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorId,
    action: "publication.jobs_queued",
    entityType: "content_entry",
    entityId: params.entryId,
    metadata: { jobs: jobs.filter(Boolean).length, correlationId },
  });
  return jobs.filter(Boolean);
}

export async function listPublicationJobs(workspaceId: string, entryId?: string) {
  let query = createServiceRoleClient()
    .from("publication_jobs")
    .select("*, publication_targets(name, target_type)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (entryId) query = query.eq("entry_id", entryId);
  const { data } = await query;
  return data ?? [];
}

/**
 * Compatibility dispatcher for the original publication_jobs projection.
 * Phase 10's external worker owns normal execution; this remains useful for
 * manual recovery and existing API compatibility.
 */
export async function dispatchPublicationJob(workspaceId: string, jobId: string) {
  const db = createServiceRoleClient();
  const { data: job } = await db
    .from("publication_jobs")
    .select("*, publication_targets!inner(config_json_encrypted, active)")
    .eq("workspace_id", workspaceId)
    .eq("id", jobId)
    .maybeSingle();
  if (!job || !job.publication_targets?.active) throw new Error("Active publication job not found");
  if (["succeeded", "cancelled"].includes(job.status)) return job;

  const attempt = job.attempt_count + 1;
  const startedAt = Date.now();
  await db
    .from("publication_jobs")
    .update({ status: "running", attempt_count: attempt, started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", job.id);

  try {
    const config = decryptConfig<TargetConfig>(job.publication_targets.config_json_encrypted);
    const signingSecret = config.signingSecret || process.env.CMS_DELIVERY_SIGNING_SECRET;
    if (!signingSecret) throw new Error("Publication signing secret is not configured");
    const payload = JSON.stringify({
      event: "publication.requested",
      publicationJobId: job.id,
      entryId: job.entry_id,
      versionId: job.version_id,
      releaseId: job.release_id,
    });
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": job.idempotency_key,
        "x-polynovea-publication-job": job.id,
        "x-polynovea-signature": `sha256=${createHmac("sha256", signingSecret).update(payload).digest("hex")}`,
        ...(config.headers ?? {}),
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    const success = response.ok;
    const status = success ? "succeeded" : attempt >= job.max_attempts ? "failed" : "retrying";
    await db.from("publication_delivery_logs").insert({
      job_id: job.id,
      attempt_number: attempt,
      status_code: response.status,
      outcome: status,
      detail: success ? null : `Destination returned ${response.status}`,
    });
    await db
      .from("publication_jobs")
      .update({
        status,
        completed_at: success ? new Date().toISOString() : null,
        next_attempt_at: success ? null : retryAt(attempt),
        last_error: success ? null : `Destination returned ${response.status}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    await db.rpc("cms_record_destination_health", {
      p_workspace_id: workspaceId,
      p_destination_kind: "publication_target",
      p_destination_id: job.target_id,
      p_success: success,
      p_latency_ms: Date.now() - startedAt,
      p_error_code: success ? null : `HTTP_${response.status}`,
      p_error_message: success ? null : `Destination returned ${response.status}`,
      p_disabled: false,
    });
    return { ...job, status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delivery failed";
    const status = attempt >= job.max_attempts ? "failed" : "retrying";
    await db.from("publication_delivery_logs").insert({
      job_id: job.id,
      attempt_number: attempt,
      outcome: status,
      detail: message,
    });
    await db
      .from("publication_jobs")
      .update({
        status,
        next_attempt_at: retryAt(attempt),
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    await db.rpc("cms_record_destination_health", {
      p_workspace_id: workspaceId,
      p_destination_kind: "publication_target",
      p_destination_id: job.target_id,
      p_success: false,
      p_latency_ms: Date.now() - startedAt,
      p_error_code: "NETWORK_ERROR",
      p_error_message: message,
      p_disabled: false,
    });
    return { ...job, status };
  }
}
