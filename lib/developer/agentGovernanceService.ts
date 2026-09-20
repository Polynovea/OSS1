import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";
import { sha256Canonical } from "@/lib/intelligence/operationalCanonical";
import { evaluateAgentToolAccess, getAgentToolDefinition, type AgentOperationClass } from "@/lib/developer/agentToolRegistry";

export interface AgentIdentityRecord {
  id: string;
  workspace_id: string;
  agent_key: string;
  name: string;
  status: "active" | "suspended" | "revoked";
  default_mode: "draft_only" | "scoped";
  provider: string | null;
  model: string | null;
  metadata_json: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function listAgentIdentities(workspaceId: string) {
  const { data, error } = await createServiceRoleClient()
    .from("agent_identities")
    .select("id,workspace_id,agent_key,name,status,default_mode,provider,model,metadata_json,created_by,updated_by,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AgentIdentityRecord[];
}

export async function createAgentIdentity(params: {
  workspaceId: string;
  actorId: string;
  agentKey: string;
  name: string;
  provider?: string | null;
  model?: string | null;
  defaultMode?: "draft_only" | "scoped";
  metadata?: Record<string, unknown>;
}) {
  const agentKey = params.agentKey.trim().toLowerCase();
  const name = params.name.trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,127}$/.test(agentKey)) throw new Error("Agent key is invalid");
  if (!name) throw new Error("Agent name is required");

  const db = createServiceRoleClient();
  const { data, error } = await db.from("agent_identities").insert({
    workspace_id: params.workspaceId,
    agent_key: agentKey,
    name,
    status: "active",
    default_mode: params.defaultMode ?? "draft_only",
    provider: params.provider?.trim() || null,
    model: params.model?.trim() || null,
    metadata_json: params.metadata ?? {},
    created_by: params.actorId,
    updated_by: params.actorId,
  }).select("id,workspace_id,agent_key,name,status,default_mode,provider,model,metadata_json,created_by,updated_by,created_at,updated_at").single();
  if (error || !data) throw new Error(error?.message || "Could not create agent identity");

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorId,
    action: "agent.identity.created",
    entityType: "agent_identity",
    entityId: data.id,
    metadata: { agentKey, defaultMode: data.default_mode, provider: data.provider, model: data.model },
  });
  return data as AgentIdentityRecord;
}

export async function bindDeveloperTokenToAgent(params: {
  workspaceId: string;
  actorId: string;
  tokenId: string;
  agentIdentityId: string;
}) {
  const db = createServiceRoleClient();
  const [{ data: token, error: tokenError }, { data: agent, error: agentError }] = await Promise.all([
    db.from("developer_api_tokens").select("id,workspace_id,agent_identity_id,revoked_at").eq("workspace_id", params.workspaceId).eq("id", params.tokenId).maybeSingle(),
    db.from("agent_identities").select("id,workspace_id,status,agent_key").eq("workspace_id", params.workspaceId).eq("id", params.agentIdentityId).maybeSingle(),
  ]);
  if (tokenError || agentError) throw new Error(tokenError?.message || agentError?.message || "Could not validate agent binding");
  if (!token) throw new Error("Developer API token not found in workspace");
  if (!agent) throw new Error("Agent identity not found in workspace");
  if (token.revoked_at) throw new Error("Cannot bind a revoked developer API token");
  if (agent.status !== "active") throw new Error("Cannot bind a non-active agent identity");

  const { data, error } = await db.from("developer_api_tokens")
    .update({ agent_identity_id: params.agentIdentityId, updated_at: new Date().toISOString() })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.tokenId)
    .select("id,workspace_id,agent_identity_id")
    .single();
  if (error || !data) throw new Error(error?.message || "Could not bind developer API token to agent");

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorId,
    action: "agent.token.bound",
    entityType: "agent_identity",
    entityId: params.agentIdentityId,
    metadata: { tokenId: params.tokenId, agentKey: agent.agent_key },
  });
  return data;
}

export async function resolveBoundAgent(params: { workspaceId: string; tokenId: string }) {
  const db = createServiceRoleClient();
  const { data: token, error } = await db.from("developer_api_tokens")
    .select("id,workspace_id,agent_identity_id,scopes,revoked_at")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.tokenId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!token || token.revoked_at || !token.agent_identity_id) return null;

  const { data: agent, error: agentError } = await db.from("agent_identities")
    .select("id,workspace_id,agent_key,name,status,default_mode,provider,model,metadata_json")
    .eq("workspace_id", params.workspaceId)
    .eq("id", token.agent_identity_id)
    .maybeSingle();
  if (agentError) throw new Error(agentError.message);
  if (!agent || agent.status !== "active") return null;
  return { token, agent };
}

export async function authorizeBoundAgentTool(params: {
  workspaceId: string;
  tokenId: string;
  toolName: string;
  initiatingAdminUserId?: string | null;
}) {
  const bound = await resolveBoundAgent({ workspaceId: params.workspaceId, tokenId: params.tokenId });
  if (!bound) return { allowed: false as const, code: "AGENT_IDENTITY_REQUIRED", bound: null, tool: getAgentToolDefinition(params.toolName) };
  const access = evaluateAgentToolAccess({
    toolName: params.toolName,
    tokenScopes: Array.isArray(bound.token.scopes) ? bound.token.scopes.map(String) : [],
    agentDefaultMode: bound.agent.default_mode,
    initiatingAdminUserId: params.initiatingAdminUserId ?? null,
  });
  return { ...access, bound };
}

export async function recordAgentOperationProvenance(params: {
  workspaceId: string;
  agentIdentityId: string;
  developerApiTokenId?: string | null;
  initiatingAdminUserId?: string | null;
  requestId: string;
  toolName: string;
  operationClass?: AgentOperationClass;
  status: "requested" | "allowed" | "blocked" | "approval_required" | "succeeded" | "failed";
  modelProvider?: string | null;
  modelName?: string | null;
  sourceContext?: Array<Record<string, unknown>>;
  changedFields?: string[];
  beforeJson?: unknown;
  afterJson?: unknown;
  safeInputSummary?: unknown;
  approvalReferenceType?: string | null;
  approvalReferenceId?: string | null;
  operationalPlanId?: string | null;
  simulationRunId?: string | null;
  evidencePackageId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const definition = getAgentToolDefinition(params.toolName);
  const operationClass = params.operationClass ?? definition?.operationClass;
  if (!operationClass) throw new Error(`Unknown agent tool provenance class: ${params.toolName}`);
  if (operationClass !== "read" && !params.initiatingAdminUserId) throw new Error("Agent mutations require an initiating admin user");

  const { data, error } = await createServiceRoleClient().from("agent_operation_provenance").insert({
    workspace_id: params.workspaceId,
    agent_identity_id: params.agentIdentityId,
    developer_api_token_id: params.developerApiTokenId ?? null,
    initiating_admin_user_id: params.initiatingAdminUserId ?? null,
    request_id: params.requestId,
    tool_name: params.toolName,
    operation_class: operationClass,
    status: params.status,
    model_provider: params.modelProvider ?? null,
    model_name: params.modelName ?? null,
    source_context_json: params.sourceContext ?? [],
    changed_fields: [...new Set(params.changedFields ?? [])],
    before_json: params.beforeJson ?? null,
    after_json: params.afterJson ?? null,
    input_digest_sha256: params.safeInputSummary === undefined ? null : sha256Canonical(params.safeInputSummary),
    approval_reference_type: params.approvalReferenceType ?? null,
    approval_reference_id: params.approvalReferenceId ?? null,
    operational_plan_id: params.operationalPlanId ?? null,
    simulation_run_id: params.simulationRunId ?? null,
    evidence_package_id: params.evidencePackageId ?? null,
    metadata_json: params.metadata ?? {},
  }).select("*").single();
  if (error || !data) throw new Error(error?.message || "Could not record agent provenance");
  return data;
}

export async function recordBoundAgentMutation(params: { context: { agentIdentityId: string | null; tokenId: string; workspaceId: string; actorAdminUserId: string | null; requestId: string; agentToolName: string | null }; toolName: string; changedFields?: string[]; beforeJson?: unknown; afterJson?: unknown; safeInputSummary?: unknown; operationalPlanId?: string | null; simulationRunId?: string | null; evidencePackageId?: string | null }) {
  if (!params.context.agentIdentityId) return null;
  return recordAgentOperationProvenance({
    workspaceId: params.context.workspaceId, agentIdentityId: params.context.agentIdentityId, developerApiTokenId: params.context.tokenId,
    initiatingAdminUserId: params.context.actorAdminUserId, requestId: params.context.requestId, toolName: params.toolName,
    status: "succeeded", changedFields: params.changedFields, beforeJson: params.beforeJson, afterJson: params.afterJson,
    safeInputSummary: params.safeInputSummary, operationalPlanId: params.operationalPlanId, simulationRunId: params.simulationRunId, evidencePackageId: params.evidencePackageId,
  });
}
