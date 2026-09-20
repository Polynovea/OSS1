import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { getModel, getVersion } from "@/lib/schema/modelService";
import { logPlatformEvent } from "@/lib/platform/audit";

export async function getDataAwareChangeAssessment(workspaceId: string, assessmentId: string) {
  const { data, error } = await createServiceRoleClient()
    .from("operational_change_assessments")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", assessmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw Object.assign(new Error("Data-aware change assessment not found"), { status: 404 });
  return data;
}

export async function deployAssessedCanonicalSchema(params: {
  workspaceId: string;
  environmentId: string;
  modelId: string;
  actorId: string;
  assessmentId: string;
  strategyKey?: "direct_metadata_change" | "deprecate_retain";
}) {
  const db = createServiceRoleClient();
  const [model, assessment] = await Promise.all([
    getModel(params.workspaceId, params.modelId),
    getDataAwareChangeAssessment(params.workspaceId, params.assessmentId),
  ]);
  if (!model) throw Object.assign(new Error("Model not found"), { status: 404 });
  if (assessment.environment_id !== params.environmentId || assessment.content_model_id !== params.modelId) {
    throw Object.assign(new Error("Assessment belongs to a different environment/model"), { status: 409 });
  }

  const ageMs = Date.now() - new Date(assessment.created_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs > 15 * 60 * 1000) {
    throw Object.assign(new Error("Data-aware assessment is stale. Reassess the target before deployment."), { status: 409 });
  }

  const currentVersion = await getVersion(model.id, model.current_schema_version);
  if (!currentVersion) throw Object.assign(new Error("Current canonical schema version is unavailable"), { status: 409 });
  const assessedTargetVersion = Number(assessment.target_schema_version ?? model.current_schema_version);
  const assessedTargetHash = String(assessment.target_schema_hash ?? assessment.proposed_schema_hash ?? "");
  if (assessedTargetVersion !== model.current_schema_version || assessedTargetHash !== currentVersion.schema_hash) {
    throw Object.assign(new Error("Canonical target changed after this assessment. Reassess before deployment."), { status: 409 });
  }
  const assessedEntryCount = Number(assessment.data_profile_json?.entryCount ?? 0);
  if (assessment.provenance_state === "ambiguous" || (assessedEntryCount > 0 && assessment.provenance_state !== "proven")) {
    throw Object.assign(new Error("Automatic schema deployment is blocked because populated target schema provenance is not proven."), { status: 409, code: "UNPROVEN_SCHEMA_PROVENANCE" });
  }

  const blockers = Array.isArray(assessment.hard_blockers_json) ? assessment.hard_blockers_json : [];
  const strategyKey = params.strategyKey ?? "direct_metadata_change";
  const retainOnlyRemoval = strategyKey === "deprecate_retain" && blockers.length > 0 && blockers.every((item: any) => String(item?.code ?? "") === "POPULATED_FIELD_REMOVAL");
  if ((blockers.length || assessment.status === "blocked") && !retainOnlyRemoval) {
    throw Object.assign(new Error("Target data is not compatible with direct canonical schema deployment. Select and execute an explicit migration/backfill strategy first."), { status: 409, blockers });
  }
  const sourceClassification = String(assessment.deterministic_classification);
  const classification = retainOnlyRemoval ? "safe" : sourceClassification;
  if (!["safe", "requires_lock"].includes(classification)) {
    throw Object.assign(new Error(`Direct canonical deployment is not allowed for deterministic classification ${sourceClassification}`), { status: 409 });
  }

  const { data: environment } = await db.from("workspace_environments")
    .select("id,kind")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.environmentId)
    .maybeSingle();
  if (!environment) throw Object.assign(new Error("Environment not found"), { status: 404 });
  if (environment.kind === "production" && classification !== "safe") {
    throw Object.assign(new Error("Production schema deployment must be deterministically SAFE; lock-sensitive changes require an explicit governed migration plan."), { status: 409 });
  }

  const now = new Date().toISOString();
  const { data: deployment, error } = await db.from("environment_schema_deployments").upsert({
    workspace_id: params.workspaceId,
    environment_id: params.environmentId,
    content_model_id: params.modelId,
    schema_version: model.current_schema_version,
    schema_hash: currentVersion.schema_hash,
    status: "deployed",
    deployed_by: params.actorId,
    deployed_at: now,
    metadata_json: {
      channel: "phase12_75_data_aware_controller",
      assessmentId: assessment.id,
      deterministicClassification: classification,
      sourceAssessmentClassification: sourceClassification,
      migrationStrategy: strategyKey,
      targetDataEvidence: {
        entryCount: assessment.data_profile_json?.entryCount ?? null,
        versionCount: assessment.data_profile_json?.versionCount ?? null,
        blockerCount: blockers.length,
        warningCount: Array.isArray(assessment.warnings_json) ? assessment.warnings_json.length : 0,
      },
    },
  }, { onConflict: "environment_id,content_model_id,schema_version" }).select().single();
  if (error || !deployment) throw new Error(error?.message || "Could not record canonical schema deployment");

  await db.from("workspace_environments").update({
    deployed_schema_hash: currentVersion.schema_hash,
    deployed_schema_revision: `${model.api_key}:v${model.current_schema_version}`,
    updated_at: now,
  }).eq("workspace_id", params.workspaceId).eq("id", params.environmentId);

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorId,
    action: "operational.schema_change.deployed",
    entityType: "environment_schema_deployment",
    entityId: deployment.id,
    metadata: {
      environmentId: params.environmentId,
      modelId: params.modelId,
      assessmentId: assessment.id,
      schemaVersion: model.current_schema_version,
      schemaHash: currentVersion.schema_hash,
      deterministicClassification: classification,
      sourceAssessmentClassification: sourceClassification,
      migrationStrategy: strategyKey,
    },
  });

  return {
    deployment,
    assessmentId: assessment.id,
    schemaVersion: model.current_schema_version,
    schemaHash: currentVersion.schema_hash,
    deterministicClassification: classification,
    sourceAssessmentClassification: sourceClassification,
    migrationStrategy: strategyKey,
  };
}
