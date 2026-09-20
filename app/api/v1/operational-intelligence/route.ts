import { requireDeveloperApi } from "@/lib/developer/apiAuth";
import { apiError, apiSuccess } from "@/lib/developer/apiContract";
import { logDeveloperApiMutation } from "@/lib/developer/developerAudit";
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
import { resolveAgentToolForApiRequest } from "@/lib/developer/agentRouteMapping";

export async function GET(req: Request) {
  const auth = await requireDeveloperApi(req, { scope: "operational_intelligence.read" });
  if (auth.error) return auth.error;
  try {
    const environments = await listEnvironments(auth.data!.workspaceId);
    const url = new URL(req.url);
    const environmentId = url.searchParams.get("environmentId") || environments[0]?.id || null;
    const overview = environmentId ? await getOperationalIntelligenceOverview(auth.data!.workspaceId, environmentId) : null;
    return apiSuccess({ environments, environmentId, overview }, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });
  } catch (error) {
    return apiError("OPERATIONAL_INTELLIGENCE_READ_FAILED", error instanceof Error ? error.message : "Could not read operational intelligence", 500, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });
  }
}

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return apiError("INVALID_REQUEST", "Request body must be JSON", 400); }
  const operation = String(body.operation || "");
  const executeOperations = new Set(["migration_execute", "remediation_execute", "auto_repair", "approval_request", "execute"]);
  const policyOperations = new Set(["policy_update", "ml_train", "ml_policy_update", "ml_retention_enforce", "ml_evaluate_online"]);
  const requiredScope = executeOperations.has(operation)
    ? "operational_intelligence.execute"
    : policyOperations.has(operation)
      ? "operational_intelligence.policy"
      : "operational_intelligence.write";
  const agentToolName = resolveAgentToolForApiRequest({ method: req.method, pathname: new URL(req.url).pathname, operation });
  const auth = await requireDeveloperApi(req, { scope: requiredScope, requireActor: true, agentToolName: agentToolName ?? undefined });
  if (auth.error) return auth.error;
  const workspaceId = auth.data!.workspaceId;
  const actorId = auth.data!.actorAdminUserId!;
  const environmentId = String(body.environmentId || "");
  if (!environmentId) return apiError("ENVIRONMENT_REQUIRED", "environmentId is required", 400, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });
  try {
    let result: unknown;
    if (operation === "discover") result = await refreshOperationalWorldModel({ workspaceId, environmentId, actorId, source: "api" });
    else if (operation === "desired_generate") result = await createDesiredStateRevision({ workspaceId, environmentId, actorId, activate: body.activate !== false, source: "generated_baseline", changeNote: body.changeNote || "Generated from canonical CMS declarations" });
    else if (operation === "desired_create") result = await createDesiredStateRevision({ workspaceId, environmentId, actorId, desired: body.desired as OperationalDesiredState, activate: Boolean(body.activate), source: "api", changeNote: body.changeNote || null });
    else if (operation === "desired_activate") result = await activateDesiredStateRevision({ workspaceId, environmentId, revisionId: String(body.revisionId), actorId });
    else if (operation === "reconcile") result = await reconcileOperationalState({ workspaceId, environmentId, actorId, desiredStateRevisionId: body.desiredStateRevisionId || null, refreshWorld: body.refreshWorld !== false });
    else if (operation === "plan") result = await createOperationalPlan({ workspaceId, environmentId, actorId, desiredStateRevisionId: body.desiredStateRevisionId || null, reconciliationRunId: body.reconciliationRunId || null, name: body.name || null });
    else if (operation === "simulate") result = await simulateOperationalPlan({ workspaceId, environmentId, actorId, planId: String(body.planId), approvalRequestId: body.approvalRequestId || null });
    else if (operation === "assess_schema_change") {
      const modelId = String(body.modelId || "");
      if (!modelId) return apiError("MODEL_REQUIRED", "modelId is required", 400, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });
      let proposedSchema = body.schema;
      if (!proposedSchema) {
        const model = await getModel(workspaceId, modelId);
        if (!model) return apiError("MODEL_NOT_FOUND", "Model not found", 404, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });
        const version = await getVersion(model.id, model.current_schema_version);
        if (!version) return apiError("MODEL_VERSION_NOT_FOUND", "Current model version not found", 409, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });
        proposedSchema = version.schema_json;
      }
      result = await assessDataAwareSchemaChange({ workspaceId, environmentId, modelId, actorId, proposedSchema });
    }
    else if (operation === "migration_execute") result = await executeAssessedMigrationStrategy({ workspaceId, environmentId, actorId, assessmentId: String(body.assessmentId), strategyKey: body.strategyKey, input: body.input ?? {}, maxBatches: body.maxBatches == null ? undefined : Number(body.maxBatches) });
    else if (operation === "plan_compare") result = await compareOperationalPlanScenarios({ workspaceId, environmentId, planId: String(body.planId), actorId });
    else if (operation === "plan_select") result = await selectOperationalPlanScenario({ workspaceId, environmentId, comparisonId: String(body.comparisonId), scenarioKey: String(body.scenarioKey), actorId, reason: body.reason ? String(body.reason) : null });
    else if (operation === "remediation_execute") result = await executeDeterministicRemediation({ workspaceId, environmentId, actorId, remediationKey: String(body.remediationKey), targetType: String(body.targetType || "workspace_environment"), targetId: body.targetId ? String(body.targetId) : null, sourceDriftItemId: body.sourceDriftItemId ? String(body.sourceDriftItemId) : null, executionMode: body.executionMode === "approval_execute" ? "approval_execute" : "manual", desiredStateRevisionId: body.desiredStateRevisionId ? String(body.desiredStateRevisionId) : null });
    else if (operation === "auto_repair") result = await runPolicyAutoRepair({ workspaceId, environmentId, actorId });
    else if (operation === "approval_request") result = await requestInfrastructureApproval({ workspaceId, environmentId, actorId, operation: "change_execute", entityType: "operational_change_plan", entityId: String(body.planId), reason: String(body.reason || "Execute reviewed deterministic operational plan"), request: { planId: String(body.planId), planChecksum: body.planChecksum || null } });
    else if (operation === "execute") result = await executeOperationalPlan({ workspaceId, environmentId, actorId, planId: String(body.planId), approvalRequestId: body.approvalRequestId || null });
    else if (operation === "policy_update") result = await updateAutonomyPolicy({ workspaceId, environmentId, actorId, mode: body.mode, allowedRemediationKeys: Array.isArray(body.allowedRemediationKeys) ? body.allowedRemediationKeys.map(String) : [], maxDeterministicClassification: body.maxDeterministicClassification || "safe", settings: body.settings ?? {} });
    else if (operation === "ml_train") { await enforceOperationalLearningRetention(workspaceId); result = await trainSupportedOperationalModels({ workspaceId, environmentId, actorId }); }
    else if (operation === "ml_predict_plan") result = await predictOperationalPlan({ workspaceId, environmentId, planId: String(body.planId), actorId });
    else if (operation === "ml_predict_remediation") result = await predictRemediationSuccess({ workspaceId, environmentId, remediationKey: String(body.remediationKey), subjectId: body.subjectId ? String(body.subjectId) : null, actorId });
    else if (operation === "ml_policy_update") result = await updateOperationalLearningPolicy({ workspaceId, actorId, localLearningEnabled: body.localLearningEnabled !== false, crossInstallLearningOptIn: body.crossInstallLearningOptIn === true, contentLevelFeaturesEnabled: body.contentLevelFeaturesEnabled === true, retentionDays: body.retentionDays == null ? undefined : Number(body.retentionDays) });
    else if (operation === "ml_feedback") result = await recordPredictionFeedback({ workspaceId, actorId, predictionId: String(body.predictionId), feedbackType: body.feedbackType, correctedLabel: body.correctedLabel ? String(body.correctedLabel) : null, reason: body.reason ? String(body.reason) : null, metadata: body.metadata ?? {} });
    else if (operation === "ml_retention_enforce") result = await enforceOperationalLearningRetention(workspaceId);
    else if (operation === "ml_evaluate_online") result = await refreshOnlineModelEvaluations(workspaceId, environmentId);
    else return apiError("UNSUPPORTED_OPERATION", "Unsupported operational intelligence operation", 400, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });

    await logDeveloperApiMutation(auth.data!, `developer.operational_intelligence.${operation}`, "workspace_environment", environmentId, { operation, planId: body.planId || null, modelId: body.modelId || null, remediationKey: body.remediationKey || null, assessmentId: body.assessmentId || null, comparisonId: body.comparisonId || null });
    return apiSuccess(result, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });
  } catch (error: any) {
    return apiError("OPERATIONAL_INTELLIGENCE_OPERATION_FAILED", error instanceof Error ? error.message : "Operational intelligence operation failed", Number(error?.status) || 400, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });
  }
}
