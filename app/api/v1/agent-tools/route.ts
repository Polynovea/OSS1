import { apiError, apiSuccess } from "@/lib/developer/apiContract";
import { requireDeveloperApi } from "@/lib/developer/apiAuth";
import { authorizeBoundAgentTool, recordAgentOperationProvenance } from "@/lib/developer/agentGovernanceService";

/**
 * MCP's control-plane endpoint. It deliberately performs no CMS mutation.
 * A client must obtain an authorization/provenance record here, then invoke
 * the ordinary scoped v1 resource route for the actual operation.
 */
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return apiError("INVALID_REQUEST", "Request body must be JSON", 400); }
  const auth = await requireDeveloperApi(req, { scope: "agent.read", requireActor: true, allowBoundAgentControl: true });
  if (auth.error) return auth.error;
  const toolName = String(body.toolName || "");
  const action = String(body.action || "authorize");
  if (action !== "authorize") return apiError("UNSUPPORTED_AGENT_CONTROL_ACTION", "Only authorization is exposed here; governed resource routes finalize provenance", 400, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });
  if (!toolName) return apiError("TOOL_REQUIRED", "toolName is required", 400, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });

  try {
    const access = await authorizeBoundAgentTool({
      workspaceId: auth.data!.workspaceId,
      tokenId: auth.data!.tokenId,
      toolName,
      // The initiating user is the audited creator attached to the token; it
      // is never accepted from an untrusted MCP request body.
      initiatingAdminUserId: auth.data!.actorAdminUserId,
    });
    const bound = access.bound;
    if (!bound) return apiError("AGENT_IDENTITY_REQUIRED", "This token is not bound to an active agent identity", 403, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });

    const status = access.allowed ? "allowed" : "blocked";
    const provenance = await recordAgentOperationProvenance({
      workspaceId: auth.data!.workspaceId,
      agentIdentityId: bound.agent.id,
      developerApiTokenId: auth.data!.tokenId,
      initiatingAdminUserId: auth.data!.actorAdminUserId,
      requestId: auth.data!.requestId,
      toolName,
      status,
      modelProvider: body.modelProvider ? String(body.modelProvider) : null,
      modelName: body.modelName ? String(body.modelName) : null,
      sourceContext: Array.isArray(body.sourceContext) ? body.sourceContext : [],
      changedFields: Array.isArray(body.changedFields) ? body.changedFields.map(String) : [],
      safeInputSummary: body.safeInputSummary,
      approvalReferenceType: body.approvalReferenceType ? String(body.approvalReferenceType) : null,
      approvalReferenceId: body.approvalReferenceId ? String(body.approvalReferenceId) : null,
      operationalPlanId: body.operationalPlanId ? String(body.operationalPlanId) : null,
      simulationRunId: body.simulationRunId ? String(body.simulationRunId) : null,
      evidencePackageId: body.evidencePackageId ? String(body.evidencePackageId) : null,
      metadata: { agentControlAction: action, authorizationCode: access.code },
    });
    if (!access.allowed) {
      return apiError(access.code, "The bound agent is not authorized for this tool", 403, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit, details: { provenanceId: provenance.id } });
    }
    return apiSuccess({ authorization: access, provenanceId: provenance.id }, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });
  } catch (error) {
    return apiError("AGENT_TOOL_CONTROL_FAILED", error instanceof Error ? error.message : "Could not authorize agent tool", 400, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });
  }
}
