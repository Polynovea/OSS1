import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { decryptConfig, encryptConfig } from "@/lib/content/secureConfig";
import type { SecretProviderKind } from "@/lib/infrastructure/types";

export interface PreparedCredentialInput {
  purpose: string;
  label: string;
  locator: string;
  encryptedValue: string | null;
  maskedHint: string | null;
  metadata: Record<string, unknown>;
}

const mask = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("@") && !trimmed.includes("BEGIN")) {
    const [left, right] = trimmed.split("@");
    return `${left.slice(0, 2)}***@${right ?? ""}`;
  }
  const tail = trimmed.replace(/\s+/g, "").slice(-4);
  return tail ? `••••${tail}` : "••••";
};

export function prepareCredentialForProvider(params: {
  providerKind: SecretProviderKind;
  purpose: string;
  label: string;
  value?: string | null;
  locator?: string | null;
  defaultLocator?: string | null;
  metadata?: Record<string, unknown>;
}): PreparedCredentialInput {
  const locator = (params.locator ?? params.defaultLocator ?? "").trim();
  if (params.providerKind === "environment") {
    if (!locator || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(locator)) throw new Error(`${params.label}: a valid environment variable name is required`);
    if (params.value?.trim()) throw new Error(`${params.label}: environment-provider credentials must reference an environment variable instead of storing plaintext`);
    return { purpose: params.purpose, label: params.label, locator, encryptedValue: null, maskedHint: `env:${locator}`, metadata: params.metadata ?? {} };
  }
  if (params.providerKind === "encrypted_postgres") {
    const value = params.value?.trim() ?? "";
    if (!value) throw new Error(`${params.label}: a credential value is required`);
    return {
      purpose: params.purpose,
      label: params.label,
      locator: locator || "encrypted-postgres",
      encryptedValue: encryptConfig({ value }),
      maskedHint: mask(value),
      metadata: params.metadata ?? {},
    };
  }
  throw new Error(`${params.label}: credential provider ${params.providerKind} is declared but its write adapter is not implemented yet`);
}

export async function resolveCredentialRef(refId: string, workspaceId: string): Promise<string> {
  const db = createServiceRoleClient();
  const { data: ref, error } = await db
    .from("workspace_secret_refs")
    .select("id,workspace_id,locator,encrypted_value,state,provider_id")
    .eq("id", refId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !ref) throw new Error("Credential reference is unavailable");
  const { data: provider } = await db
    .from("workspace_secret_providers")
    .select("provider_kind,status")
    .eq("id", ref.provider_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!provider || provider.status !== "active") throw new Error("Credential provider is unavailable");
  if (provider.provider_kind === "environment") {
    const value = process.env[ref.locator];
    if (!value) throw new Error(`Environment credential ${ref.locator} is not configured`);
    return value;
  }
  if (provider.provider_kind === "encrypted_postgres") {
    if (!ref.encrypted_value) throw new Error("Encrypted credential value is missing");
    const payload = decryptConfig<{ value: string }>(ref.encrypted_value);
    if (!payload?.value) throw new Error("Encrypted credential payload is invalid");
    return payload.value;
  }
  throw new Error(`Credential provider ${provider.provider_kind} is not available in this runtime`);
}

export async function resolveConnectionCredentials(workspaceId: string, connectionId: string) {
  const db = createServiceRoleClient();
  const { data: bindings, error } = await db
    .from("connection_secret_bindings")
    .select("purpose,secret_ref_id")
    .eq("workspace_id", workspaceId)
    .eq("connection_id", connectionId);
  if (error) throw new Error(error.message);
  const resolved: Record<string, string> = {};
  for (const binding of bindings ?? []) resolved[binding.purpose] = await resolveCredentialRef(binding.secret_ref_id, workspaceId);
  return resolved;
}

export function redactCredentials(message: string, credentials: Record<string, string>) {
  let safe = message;
  for (const value of Object.values(credentials)) {
    if (!value) continue;
    safe = safe.split(value).join("[REDACTED]");
    const compact = value.replace(/\s+/g, "");
    if (compact.length > 12) safe = safe.split(compact).join("[REDACTED]");
  }
  return safe.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
}
