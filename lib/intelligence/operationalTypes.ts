export type OperationalFactKind = "observed" | "declared" | "inferred" | "desired";

export type OperationalCapabilityState =
  | "supported"
  | "present"
  | "missing"
  | "outdated"
  | "degraded"
  | "unverified"
  | "unsupported"
  | "healthy"
  | "blocked"
  | "unknown";

export type OperationalNodeType =
  | "environment"
  | "database"
  | "auth"
  | "storage"
  | "secret_provider"
  | "runtime"
  | "component"
  | "connection"
  | "website"
  | "api"
  | "analytics"
  | "search"
  | "schema"
  | "model"
  | "migration"
  | "worker"
  | "scheduler"
  | "backup"
  | "release"
  | "job"
  | "other";

export type OperationalRelationship =
  | "runs_on"
  | "connects_to"
  | "authenticates_with"
  | "stores_in"
  | "served_by"
  | "publishes_to"
  | "measured_by"
  | "depends_on"
  | "requires"
  | "maps_to"
  | "deployed_as"
  | "governed_by";

export type OperationalDriftActionClass =
  | "observe_only"
  | "recommend"
  | "safe_auto_repair"
  | "approval_required"
  | "manual_provider_action_required";

export type OperationalDeterministicClassification =
  | "safe"
  | "requires_lock"
  | "requires_backfill"
  | "requires_data_migration"
  | "potentially_destructive"
  | "destructive";

export type OperationalAutonomyMode =
  | "diagnose_only"
  | "recommend"
  | "approval_execute"
  | "policy_auto_repair";

export interface OperationalWorldNodeSeed {
  nodeKey: string;
  nodeType: OperationalNodeType;
  displayName: string;
  state: OperationalCapabilityState;
  provider?: string | null;
  capabilityKey?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  attributes?: Record<string, unknown>;
  observationKind?: OperationalFactKind;
  sourceType: string;
  sourceRef?: string | null;
  evidence?: Record<string, unknown>;
  confidence?: number | null;
  validForSeconds?: number;
}

export interface OperationalWorldEdgeSeed {
  fromNodeKey: string;
  toNodeKey: string;
  relationship: OperationalRelationship;
  attributes?: Record<string, unknown>;
  sourceType: string;
  sourceRef?: string | null;
  evidence?: Record<string, unknown>;
  observationKind?: OperationalFactKind;
  confidence?: number | null;
  validForSeconds?: number;
}

export interface OperationalDesiredState {
  schemaVersion: 1;
  environment: {
    status?: "ready" | "maintenance";
  };
  capabilities: Record<
    string,
    {
      state: "present" | "supported";
      required?: boolean;
      provider?: string | null;
    }
  >;
  connections: Record<
    string,
    {
      status: "active";
      connectorType?: string;
      family?: string;
    }
  >;
  schemas: Record<
    string,
    {
      version: number;
      hash?: string | null;
      apiKey?: string;
    }
  >;
  runtime: {
    migration?: string | null;
    appVersion?: string | null;
    workerVersion?: string | null;
  };
  websites: Record<string, { status: "active" }>;
  metadata?: Record<string, unknown>;
}

export interface OperationalDriftCandidate {
  driftKey: string;
  category:
    | "environment"
    | "capability"
    | "connection"
    | "schema"
    | "migration"
    | "runtime"
    | "website"
    | "worker"
    | "storage"
    | "secret"
    | "other";
  severity: "info" | "warning" | "blocking";
  actionClass: OperationalDriftActionClass;
  nodeId?: string | null;
  current: Record<string, unknown>;
  desired: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}

export interface OperationalPlanNodeDefinition {
  nodeKey: string;
  ordinal: number;
  operation: "system.doctor" | "component.check" | "connection.verify" | "world.refresh" | "drift.recalculate" | "schema.deploy_assessed" | "schema.migrate_assessed" | "manual.action";
  targetType: string;
  targetId?: string | null;
  classification: OperationalDeterministicClassification;
  approvalClass: "none" | "environment" | "high_risk";
  retrySemantics: "none" | "safe_retry" | "manual_retry";
  timeoutSeconds: number;
  preconditions: Array<Record<string, unknown>>;
  input: Record<string, unknown>;
  verification: Record<string, unknown>;
  compensation: Record<string, unknown>;
  dependsOn: string[];
}

export interface OperationalPlanDocument {
  format: "polynovea-operational-plan";
  formatVersion: 1;
  environmentId: string;
  desiredStateRevisionId: string;
  sourceDiscoveryRunId: string | null;
  sourceReconciliationRunId: string | null;
  classification: OperationalDeterministicClassification;
  requiresApproval: boolean;
  createdAt: string;
  nodes: OperationalPlanNodeDefinition[];
}
