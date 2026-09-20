export type EnvironmentKind = "local" | "development" | "staging" | "production" | "custom";
export type EnvironmentStatus = "provisioning" | "ready" | "degraded" | "blocked" | "maintenance" | "disconnected";
export type SecretProviderKind = "environment" | "encrypted_postgres" | "supabase_vault" | "external";
export type ConnectionStatus = "unconfigured" | "configured" | "verifying" | "active" | "degraded" | "failed" | "disabled";
export type ConnectorFamily = "analytics" | "website" | "database" | "storage" | "search" | "webhook" | "communication" | "ai" | "custom";

export interface WorkspaceEnvironmentRow {
  id: string;
  workspace_id: string;
  key: string;
  name: string;
  kind: EnvironmentKind;
  status: EnvironmentStatus;
  is_default: boolean;
  cms_base_url: string | null;
  public_site_urls: string[];
  database_provider: string | null;
  storage_provider: string | null;
  runtime_provider: string | null;
  deployed_schema_hash: string | null;
  deployed_schema_revision: string | null;
  config_json: Record<string, unknown>;
  health_json: Record<string, unknown>;
  last_health_check_at: string | null;
  secret_provider_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecretProviderRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  provider_kind: SecretProviderKind;
  name: string;
  status: "active" | "degraded" | "disabled" | "unavailable";
  config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SecretRefSafeView {
  id: string;
  purpose: string;
  label: string;
  state: string;
  providerKind: SecretProviderKind;
  locator?: string;
  maskedHint: string | null;
  lastVerifiedAt: string | null;
  rotatedAt: string | null;
}

export interface WorkspaceConnectionRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  connector_type: string;
  connector_family: ConnectorFamily;
  name: string;
  status: ConnectionStatus;
  active: boolean;
  config_json: Record<string, unknown>;
  metadata_json: Record<string, unknown>;
  last_verified_at: string | null;
  last_success_at: string | null;
  last_used_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  legacy_resource_type: string | null;
  legacy_resource_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectionSafeView extends WorkspaceConnectionRow {
  environment?: Pick<WorkspaceEnvironmentRow, "id" | "key" | "name" | "kind" | "status"> | null;
  secrets: SecretRefSafeView[];
  latestVerification?: {
    id: string;
    status: "passed" | "warning" | "failed";
    checks_json: unknown[];
    safe_evidence_json: Record<string, unknown>;
    error_code: string | null;
    error_message: string | null;
    duration_ms: number | null;
    correlation_id: string;
    verified_at: string;
  } | null;
}
