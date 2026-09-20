import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { apiError, type ApiMeta } from "@/lib/developer/apiContract";
import { resolveDeveloperApiToken, type DeveloperApiScope } from "@/lib/developer/apiTokenService";
import { authorizeBoundAgentTool } from "@/lib/developer/agentGovernanceService";
import { resolveAgentToolForApiRequest } from "@/lib/developer/agentRouteMapping";

export interface DeveloperApiContext {
  requestId: string;
  workspaceId: string;
  tokenId: string;
  tokenName: string;
  actorAdminUserId: string | null;
  scopes: string[];
  allowedModels: string[];
  rateLimit: NonNullable<ApiMeta["rateLimit"]>;
  agentIdentityId: string | null;
  agentToolName: string | null;
}

export async function requireDeveloperApi(
  req: Request,
  options: { scope: DeveloperApiScope | DeveloperApiScope[]; modelApiKey?: string; requireActor?: boolean; agentToolName?: string; allowBoundAgentControl?: boolean },
): Promise<{ data?: DeveloperApiContext; error?: Response }> {
  const requestId = req.headers.get("x-request-id")?.trim() || randomUUID();
  const authorization = req.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return { error: apiError("AUTH_REQUIRED", "A Bearer API token is required", 401, { requestId }) };

  const rawToken = match[1].trim();
  if (!rawToken.startsWith("pnv_")) return { error: apiError("INVALID_TOKEN", "API token is invalid", 401, { requestId }) };

  let token;
  try { token = await resolveDeveloperApiToken(rawToken); }
  catch { return { error: apiError("AUTH_UNAVAILABLE", "API authentication is temporarily unavailable", 503, { requestId }) }; }
  if (!token) return { error: apiError("INVALID_TOKEN", "API token is invalid", 401, { requestId }) };
  if (token.revoked_at) return { error: apiError("TOKEN_REVOKED", "API token has been revoked", 401, { requestId }) };
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) return { error: apiError("TOKEN_EXPIRED", "API token has expired", 401, { requestId }) };

  const db = createServiceRoleClient();
  const { data: rateRaw, error: rateError } = await db.rpc("cms_consume_developer_api_rate_limit", {
    p_token_id: token.id,
    p_limit: token.rate_limit_per_minute,
  });
  if (rateError || !rateRaw) return { error: apiError("RATE_LIMIT_UNAVAILABLE", "API rate limiting is temporarily unavailable", 503, { requestId }) };
  const rate = rateRaw as { allowed: boolean; limit: number; remaining: number; resetAt: string };
  const rateLimit = { limit: Number(rate.limit), remaining: Number(rate.remaining), resetAt: String(rate.resetAt) };
  if (!rate.allowed) return { error: apiError("RATE_LIMITED", "API rate limit exceeded", 429, { requestId, rateLimit }) };

  const scopes = Array.isArray(token.scopes) ? token.scopes.map(String) : [];
  const requiredScopes = Array.isArray(options.scope) ? options.scope : [options.scope];
  const missing = requiredScopes.filter((scope) => !scopes.includes(scope));
  if (missing.length) return { error: apiError("INSUFFICIENT_SCOPE", `Token requires scope${missing.length === 1 ? "" : "s"} ${missing.join(", ")}`, 403, { requestId, rateLimit }) };
  const allowedModels = Array.isArray(token.allowed_models) ? token.allowed_models.map(String) : [];
  if (options.modelApiKey && allowedModels.length > 0 && !allowedModels.includes(options.modelApiKey)) {
    return { error: apiError("MODEL_RESTRICTED", "Token is not permitted to access this content model", 403, { requestId, rateLimit }) };
  }
  if (options.requireActor && !token.created_by) {
    return { error: apiError("TOKEN_ACTOR_UNAVAILABLE", "This token no longer has an active creator identity for audited mutations", 409, { requestId, rateLimit }) };
  }
  let agentIdentityId: string | null = null;
  const agentToolName = options.agentToolName ?? resolveAgentToolForApiRequest({ method: req.method, pathname: new URL(req.url).pathname });
  if (token.agent_identity_id && !options.allowBoundAgentControl) {
    if (!agentToolName) return { error: apiError("AGENT_TOOL_MAPPING_REQUIRED", "A bound agent token cannot use an unmapped mutation route", 403, { requestId, rateLimit }) };
    const agentAccess = await authorizeBoundAgentTool({ workspaceId: token.workspace_id, tokenId: token.id, toolName: agentToolName, initiatingAdminUserId: token.created_by ?? null });
    if (!agentAccess.allowed || !agentAccess.bound) return { error: apiError(agentAccess.code, "The bound agent is not authorized for this operation", 403, { requestId, rateLimit }) };
    agentIdentityId = agentAccess.bound.agent.id;
  }

  void db.from("developer_api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", token.id);
  return { data: {
    requestId,
    workspaceId: token.workspace_id,
    tokenId: token.id,
    tokenName: token.name,
    actorAdminUserId: token.created_by ?? null,
    scopes,
    allowedModels,
    rateLimit,
    agentIdentityId,
    agentToolName,
  } };
}

export function developerModelAllowed(context: DeveloperApiContext, modelApiKey: string) {
  return context.allowedModels.length === 0 || context.allowedModels.includes(modelApiKey);
}
