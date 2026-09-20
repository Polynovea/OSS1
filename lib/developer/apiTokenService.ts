import { createHash, randomBytes } from "node:crypto";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";

export const DEVELOPER_API_SCOPES = [
  "content.read",
  "content.write",
  "content.publish",
  "content.delete",
  "media.read",
  "media.write",
  "schema.read",
  "schema.write",
  "releases.read",
  "releases.write",
  "analytics.read",
  "environment.read",
  "environment.write",
  "connection.read",
  "connection.write",
  "infrastructure.read",
  "infrastructure.write",
  "operational_intelligence.read",
  "operational_intelligence.write",
  "operational_intelligence.execute",
  "operational_intelligence.policy",
  "agent.read",
  "agent.manage",
  "extension.read",
  "extension.manage",
] as const;

export type DeveloperApiScope = (typeof DEVELOPER_API_SCOPES)[number];

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function validateScopes(scopes: string[]): DeveloperApiScope[] {
  const allowed = new Set<string>(DEVELOPER_API_SCOPES);
  const unique = [...new Set(scopes)];
  const invalid = unique.filter((scope) => !allowed.has(scope));
  if (invalid.length) throw new Error(`Unsupported API token scope(s): ${invalid.join(", ")}`);
  return unique as DeveloperApiScope[];
}

export async function listDeveloperApiTokens(workspaceId: string) {
  const { data, error } = await createServiceRoleClient()
    .from("developer_api_tokens")
    .select("id, name, token_prefix, scopes, allowed_models, rate_limit_per_minute, expires_at, last_used_at, revoked_at, created_by, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createDeveloperApiToken(params: {
  workspaceId: string;
  actorId: string;
  name: string;
  scopes: string[];
  allowedModels?: string[];
  expiresAt?: string | null;
  rateLimitPerMinute?: number;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Token name is required");
  const scopes = validateScopes(params.scopes);
  if (!scopes.length) throw new Error("At least one API scope is required");
  const allowedModels = [...new Set((params.allowedModels ?? []).map((item) => item.trim()).filter(Boolean))];
  const rateLimit = params.rateLimitPerMinute ?? 120;
  if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 10_000) throw new Error("Rate limit must be between 1 and 10000 requests per minute");
  if (params.expiresAt && Number.isNaN(new Date(params.expiresAt).getTime())) throw new Error("Token expiry is invalid");

  const rawToken = `pnv_${randomBytes(32).toString("base64url")}`;
  const tokenPrefix = rawToken.slice(0, 12);
  const db = createServiceRoleClient();
  const { data, error } = await db
    .from("developer_api_tokens")
    .insert({
      workspace_id: params.workspaceId,
      name,
      token_prefix: tokenPrefix,
      token_hash: digest(rawToken),
      scopes,
      allowed_models: allowedModels,
      rate_limit_per_minute: rateLimit,
      expires_at: params.expiresAt ?? null,
      created_by: params.actorId,
    })
    .select("id, name, token_prefix, scopes, allowed_models, rate_limit_per_minute, expires_at, created_at")
    .single();
  if (error || !data) throw new Error(error?.message || "Could not create API token");

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorId,
    action: "developer.api_token.created",
    entityType: "developer_api_token",
    entityId: data.id,
    metadata: { name, scopes, allowedModels, rateLimitPerMinute: rateLimit, expiresAt: params.expiresAt ?? null },
  });
  return { token: data, secret: rawToken };
}

export async function revokeDeveloperApiToken(params: { workspaceId: string; actorId: string; tokenId: string }) {
  const db = createServiceRoleClient();
  const { data: existing } = await db
    .from("developer_api_tokens")
    .select("id, name, revoked_at")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.tokenId)
    .maybeSingle();
  if (!existing) throw new Error("API token not found");
  if (existing.revoked_at) return existing;
  const { data, error } = await db
    .from("developer_api_tokens")
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.tokenId)
    .select("id, name, revoked_at")
    .single();
  if (error || !data) throw new Error(error?.message || "Could not revoke API token");
  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorId,
    action: "developer.api_token.revoked",
    entityType: "developer_api_token",
    entityId: params.tokenId,
    metadata: { name: existing.name },
  });
  return data;
}

export async function resolveDeveloperApiToken(rawToken: string) {
  const db = createServiceRoleClient();
  const { data, error } = await db
    .from("developer_api_tokens")
    .select("id, workspace_id, name, token_prefix, scopes, allowed_models, rate_limit_per_minute, expires_at, last_used_at, revoked_at, created_by, agent_identity_id")
    .eq("token_hash", digest(rawToken))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
