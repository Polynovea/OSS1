import { requirePlatformAccess } from "@/lib/platform/permissions";
import type { PermissionKey } from "@/lib/platform/permissionCatalog";
import { listEnvironments } from "@/lib/infrastructure/environmentService";
import { requestInfrastructureApproval } from "@/lib/infrastructure/operabilityService";
import { getOperationalIntelligenceOverview } from "@/lib/intelligence/operationalIntelligenceService";
import { createOperationalPlan, executeOperationalPlan, simulateOperationalPlan, updateAutonomyPolicy } from "@/lib/intelligence/planningService";
import { assessDataAwareSchemaChange } from "@/lib/intelligence/migrationIntelligenceService";
import { executeAssessedMigrationStrategy } from "@/lib/intelligence/migrationStrategyService";
import { executeDeterministicRemediation, runPolicyAutoRepair } from "@/lib/intelligence/remediationService";
import { predictOperationalPlan, predictRemediationSuccess, trainSupportedOperationalModels, updateOperationalLearningPolicy } from "@/lib/intelligence/operationalMlService";
import { enforceOperationalLearningRetention, recordPredictionFeedback, refreshOnlineModelEvaluations } from "@/lib/intelligence/operationalMlGovernanceService";
import { compareOperationalPlanScenarios, selectOperationalPlanScenario } from "@/lib/intelligence/predictivePlanningService";
import { activateDesiredStateRevision, createDesiredStateRevision, reconcileOperationalState } from "@/lib/intelligence/reconciliationService";
import type { OperationalDesiredState } from "@/lib/intelligence/operationalTypes";
import { refreshOperationalWorldModel } from "@/lib/intelligence/worldModelService";
import { getModel, getVersion } from "@/lib/schema/modelService";

const response = (data: unknown, status = 200) => Response.json({
  success: status < 400,
  data: status < 400 ? data : null,
  error: status >= 400 ? String(data) : null,
  timestamp: new Date().toISOString(),
}, { status });

const permissionFor = (operation: string): PermissionKey => ({
  discover: "operational_intelligence.manage",
  desired_generate: "operational_intelligence.manage",
  desired_create: "operational_intelligence.manage",
  desired_activate: "operational_intelligence.manage",
  reconcile: "operational_intelligence.manage",
  plan: "operational_intelligence.manage",
  simulate: "operational_intelligence.manage",
  assess_schema_change: "operational_intelligence.manage",
  migration_execute: "operational_intelligence.execute",
  plan_compare: "operational_intelligence.manage",
  plan_select: "operational_intelligence.manage",
  remediation_execute: "operational_intelligence.execute",
  auto_repair: "operational_intelligence.execute",
  approval_request: "operational_intelligence.execute",
  execute: "operational_intelligence.execute",
  policy_update: "operational_intelligence.policy",
  ml_train: "operational_intelligence.policy",
  ml_predict_plan: "operational_intelligence.manage",
  ml_predict_remediation: "operational_intelligence.manage",
  ml_policy_update: "operational_intelligence.policy",
  ml_feedback: "operational_intelligence.manage",
  ml_retention_enforce: "operational_intelligence.policy",
  ml_evaluate_online: "operational_intelligence.policy",
} as Record<string, PermissionKey>)[operation] ?? "operational_intelligence.read";

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "operational_intelligence.read" });
  if (auth.error) return auth.error;
  try {
    const workspaceId = auth.data!.actor.workspaceId;
    const environments = await listEnvironments(workspaceId);
    const url = new URL(req.url);
    const requested = url.searchParams.get("environmentId");
    const environmentId = requested || environments[0]?.id || null;
    const overview = environmentId ? await getOperationalIntelligenceOverview(workspaceId, environmentId) : null;
    return response({ environments, environmentId, overview });
  } catch (error) {
    return response(error instanceof Error ? error.message : "Could not load operational intelligence", 500);
  }
}

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return response("Request body must be JSON", 400); }
  const operation = String(body.operation || "");
  const auth = await requirePlatformAccess(req, { permission: permissionFor(operation) });
  if (auth.error) return auth.error;
  const workspaceId = auth.data!.actor.workspaceId;
  const actorId = auth.data!.actor.adminUserId;
  const environmentId = String(body.environmentId || "");
  if (!environmentId && operation !== "") return response("environmentId is required", 400);

  try {
    if (operation === "discover") return response(await refreshOperationalWorldModel({ workspaceId, environmentId, actorId, source: "manual" }));
    if (operation === "desired_generate") return response(await createDesiredStateRevision({ workspaceId, environmentId, actorId, activate: body.activate !== false, source: "generated_baseline", changeNote: body.changeNote || "Generated from canonical CMS declarations" }));
    if (operation === "desired_create") return response(await createDesiredStateRevision({ workspaceId, environmentId, actorId, desired: body.desired as OperationalDesiredState, activate: Boolean(body.activate), source: "user", changeNote: body.changeNote || null }));
    if (operation === "desired_activate") return response(await activateDesiredStateRevision({ workspaceId, environmentId, revisionId: String(body.revisionId), actorId }));
    if (operation === "reconcile") return response(await reconcileOperationalState({ workspaceId, environmentId, actorId, desiredStateRevisionId: body.desiredStateRevisionId || null, refreshWorld: body.refreshWorld !== false }));
    if (operation === "plan") return response(await createOperationalPlan({ workspaceId, environmentId, actorId, desiredStateRevisionId: body.desiredStateRevisionId || null, reconciliationRunId: body.reconciliationRunId || null, name: body.name || null }));
    if (operation === "simulate") return response(await simulateOperationalPlan({ workspaceId, environmentId, actorId, planId: String(body.planId), approvalRequestId: body.approvalRequestId || null }));
    if (operation === "assess_schema_change") {
      const modelId = String(body.modelId || "");
      if (!modelId) return response("modelId is required", 400);
      let proposedSchema = body.schema;
      if (!proposedSchema) {
        const model = await getModel(workspaceId, modelId);
        if (!model) return response("Model not found", 404);
        const version = await getVersion(model.id, model.current_schema_version);
        if (!version) return response("Current model version not found", 409);
        proposedSchema = version.schema_json;
      }
      return response(await assessDataAwareSchemaChange({ workspaceId, environmentId, modelId, actorId, proposedSchema }));
    }
    if (operation === "migration_execute") return response(await executeAssessedMigrationStrategy({ workspaceId, environmentId, actorId, assessmentId: String(body.assessmentId), strategyKey: body.strategyKey, input: body.input ?? {}, maxBatches: body.maxBatches == null ? undefined : Number(body.maxBatches) }));
    if (operation === "plan_compare") return response(await compareOperationalPlanScenarios({ workspaceId, environmentId, planId: String(body.planId), actorId }));
    if (operation === "plan_select") return response(await selectOperationalPlanScenario({ workspaceId, environmentId, comparisonId: String(body.comparisonId), scenarioKey: String(body.scenarioKey), actorId, reason: body.reason ? String(body.reason) : null }));
    if (operation === "remediation_execute") return response(await executeDeterministicRemediation({
      workspaceId,
      environmentId,
      actorId,
      remediationKey: String(body.remediationKey),
      targetType: String(body.targetType || "workspace_environment"),
      targetId: body.targetId ? String(body.targetId) : null,
      sourceDriftItemId: body.sourceDriftItemId ? String(body.sourceDriftItemId) : null,
      executionMode: body.executionMode === "approval_execute" ? "approval_execute" : "manual",
      desiredStateRevisionId: body.desiredStateRevisionId ? String(body.desiredStateRevisionId) : null,
    }));
    if (operation === "auto_repair") return response(await runPolicyAutoRepair({ workspaceId, environmentId, actorId }));
    if (operation === "approval_request") return response(await requestInfrastructureApproval({ workspaceId, environmentId, actorId, operation: "change_execute", entityType: "operational_change_plan", entityId: String(body.planId), reason: String(body.reason || "Execute reviewed deterministic operational plan"), request: { planId: String(body.planId), planChecksum: body.planChecksum || null } }));
    if (operation === "execute") return response(await executeOperationalPlan({ workspaceId, environmentId, actorId, planId: String(body.planId), approvalRequestId: body.approvalRequestId || null }));
    if (operation === "policy_update") return response(await updateAutonomyPolicy({ workspaceId, environmentId, actorId, mode: body.mode, allowedRemediationKeys: Array.isArray(body.allowedRemediationKeys) ? body.allowedRemediationKeys.map(String) : [], maxDeterministicClassification: body.maxDeterministicClassification || "safe", settings: body.settings ?? {} }));
    if (operation === "ml_train") { await enforceOperationalLearningRetention(workspaceId); return response(await trainSupportedOperationalModels({ workspaceId, environmentId, actorId })); }
    if (operation === "ml_predict_plan") return response(await predictOperationalPlan({ workspaceId, environmentId, planId: String(body.planId), actorId }));
    if (operation === "ml_predict_remediation") return response(await predictRemediationSuccess({ workspaceId, environmentId, remediationKey: String(body.remediationKey), subjectId: body.subjectId ? String(body.subjectId) : null, actorId }));
    if (operation === "ml_policy_update") return response(await updateOperationalLearningPolicy({ workspaceId, actorId, localLearningEnabled: body.localLearningEnabled !== false, crossInstallLearningOptIn: body.crossInstallLearningOptIn === true, contentLevelFeaturesEnabled: body.contentLevelFeaturesEnabled === true, retentionDays: body.retentionDays == null ? undefined : Number(body.retentionDays) }));
    if (operation === "ml_feedback") return response(await recordPredictionFeedback({ workspaceId, actorId, predictionId: String(body.predictionId), feedbackType: body.feedbackType, correctedLabel: body.correctedLabel ? String(body.correctedLabel) : null, reason: body.reason ? String(body.reason) : null, metadata: body.metadata ?? {} }));
    if (operation === "ml_retention_enforce") return response(await enforceOperationalLearningRetention(workspaceId));
    if (operation === "ml_evaluate_online") return response(await refreshOnlineModelEvaluations(workspaceId, environmentId));
    return response("Unsupported operational intelligence operation", 400);
  } catch (error: any) {
    return response(error instanceof Error ? error.message : "Operational intelligence operation failed", Number(error?.status) || 400);
  }
}
