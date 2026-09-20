import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { ensureEnvironmentComponents } from "@/lib/infrastructure/operabilityService";
import { discoverPostgresOperationalState, type DeepPostgresDiscovery } from "@/lib/intelligence/deepDiscoveryService";
import { discoverProviderCapabilities, type ProviderCapabilityDiscovery } from "@/lib/intelligence/providerCapabilityDiscoveryService";
import type {
  OperationalCapabilityState,
  OperationalDesiredState,
  OperationalWorldEdgeSeed,
  OperationalWorldNodeSeed,
} from "@/lib/intelligence/operationalTypes";

const DEFAULT_OBSERVATION_TTL_SECONDS = 15 * 60;

function stateFromEnvironment(status: string): OperationalCapabilityState {
  if (status === "ready") return "healthy";
  if (status === "blocked") return "blocked";
  if (status === "degraded") return "degraded";
  if (status === "maintenance") return "present";
  return "unverified";
}

function stateFromComponent(state: string): OperationalCapabilityState {
  if (["supported", "present", "missing", "outdated", "degraded", "unverified", "unsupported"].includes(state)) {
    return state as OperationalCapabilityState;
  }
  if (state === "failed") return "degraded";
  return "unknown";
}

function stateFromConnection(status: string, active: boolean): OperationalCapabilityState {
  if (!active || status === "disabled") return "unsupported";
  if (status === "active") return "present";
  if (status === "failed" || status === "degraded") return "degraded";
  return "unverified";
}

function validUntil(seconds = DEFAULT_OBSERVATION_TTL_SECONDS) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function addNode(target: OperationalWorldNodeSeed[], seed: OperationalWorldNodeSeed) {
  if (!target.some((item) => item.nodeKey === seed.nodeKey)) target.push(seed);
}

function addEdge(target: OperationalWorldEdgeSeed[], seed: OperationalWorldEdgeSeed) {
  if (!target.some((item) => item.fromNodeKey === seed.fromNodeKey && item.toNodeKey === seed.toNodeKey && item.relationship === seed.relationship)) target.push(seed);
}

export async function refreshOperationalWorldModel(params: {
  workspaceId: string;
  environmentId: string;
  actorId?: string | null;
  source?: "controller" | "system_doctor" | "manual" | "api" | "scheduler";
}) {
  const db = createServiceRoleClient();
  const correlationId = randomUUID();
  const startedAt = new Date().toISOString();
  const { data: run, error: runError } = await db
    .from("operational_discovery_runs")
    .insert({
      workspace_id: params.workspaceId,
      environment_id: params.environmentId,
      status: "running",
      correlation_id: correlationId,
      source: params.source ?? "controller",
      started_at: startedAt,
      created_by: params.actorId ?? null,
    })
    .select()
    .single();
  if (runError || !run) throw new Error(runError?.message || "Could not start operational discovery");

  try {
    const { data: environment } = await db
      .from("workspace_environments")
      .select("*")
      .eq("workspace_id", params.workspaceId)
      .eq("id", params.environmentId)
      .maybeSingle();
    if (!environment) throw Object.assign(new Error("Environment not found"), { status: 404 });

    const components = await ensureEnvironmentComponents(params.workspaceId, params.environmentId);
    const [connectionsResult, websitesResult, schemasResult, modelsResult, runtimeResult, backupsResult, doctorResult, syncResult] = await Promise.all([
      db.from("workspace_connections").select("id,name,connector_type,connector_family,status,active,config_json,metadata_json,last_verified_at,last_success_at").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId),
      db.from("website_connection_bindings").select("id,connection_id,publication_target_id,integration_method,status,last_test_at,last_error").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId),
      db.from("environment_schema_deployments").select("id,content_model_id,schema_version,schema_hash,status,deployed_at,metadata_json").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).order("deployed_at", { ascending: false }),
      db.from("content_models").select("id,api_key,name,status,current_schema_version").eq("workspace_id", params.workspaceId).eq("status", "active"),
      db.from("cms_runtime_state").select("schema_migration,app_version,worker_version,updated_at").eq("singleton", true).maybeSingle(),
      db.from("workspace_backups").select("id,status,checksum_sha256,created_at,verified_at").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).order("created_at", { ascending: false }).limit(5),
      db.from("system_doctor_runs").select("id,status,summary_json,checked_at").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).order("checked_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("analytics_sync_state").select("connector_id,status,fresh_through,last_success_at,last_error,updated_at").eq("workspace_id", params.workspaceId),
    ]);

    const { data: secretProvider } = environment.secret_provider_id
      ? await db.from("workspace_secret_providers").select("id,name,provider_kind,status,config_json,updated_at").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).eq("id", environment.secret_provider_id).maybeSingle()
      : { data: null };

    const connections = connectionsResult.data ?? [];
    const websites = websitesResult.data ?? [];
    const schemaRows = schemasResult.data ?? [];
    const models = modelsResult.data ?? [];
    const runtime = runtimeResult.data ?? null;
    const backups = backupsResult.data ?? [];
    const doctor = doctorResult.data ?? null;
    const syncStates = syncResult.data ?? [];
    let deepPostgres: DeepPostgresDiscovery | null = null;
    let deepPostgresError: string | null = null;
    let providerCapabilities: ProviderCapabilityDiscovery | null = null;
    let providerCapabilitiesError: string | null = null;
    const [postgresDiscovery, providerDiscovery] = await Promise.allSettled([
      discoverPostgresOperationalState({ workspaceId: params.workspaceId, environmentId: params.environmentId }),
      discoverProviderCapabilities({ workspaceId: params.workspaceId, environmentId: params.environmentId }),
    ]);
    if (postgresDiscovery.status === "fulfilled") deepPostgres = postgresDiscovery.value;
    else deepPostgresError = postgresDiscovery.reason instanceof Error ? postgresDiscovery.reason.message : "PostgreSQL deep discovery failed";
    if (providerDiscovery.status === "fulfilled") providerCapabilities = providerDiscovery.value;
    else providerCapabilitiesError = providerDiscovery.reason instanceof Error ? providerDiscovery.reason.message : "Provider capability discovery failed";

    const nodes: OperationalWorldNodeSeed[] = [];
    const edges: OperationalWorldEdgeSeed[] = [];
    const envKey = `environment:${environment.id}`;

    addNode(nodes, {
      nodeKey: envKey,
      nodeType: "environment",
      displayName: environment.name,
      state: stateFromEnvironment(environment.status),
      provider: environment.runtime_provider,
      sourceEntityType: "workspace_environment",
      sourceEntityId: environment.id,
      sourceType: "workspace_environments",
      sourceRef: environment.id,
      attributes: {
        key: environment.key,
        kind: environment.kind,
        declaredStatus: environment.status,
        cmsBaseUrl: environment.cms_base_url,
        publicSiteUrls: environment.public_site_urls ?? [],
        databaseProvider: environment.database_provider,
        storageProvider: environment.storage_provider,
        runtimeProvider: environment.runtime_provider,
        deployedSchemaHash: environment.deployed_schema_hash,
        deployedSchemaRevision: environment.deployed_schema_revision,
      },
      evidence: { table: "workspace_environments", updatedAt: environment.updated_at },
      observationKind: "declared",
    });

    const runtimeKey = "runtime:cms";
    addNode(nodes, {
      nodeKey: runtimeKey,
      nodeType: "runtime",
      displayName: "CMS Runtime",
      state: runtime ? "present" : "unverified",
      provider: environment.runtime_provider,
      sourceEntityType: "cms_runtime_state",
      sourceEntityId: "singleton",
      sourceType: "cms_runtime_state",
      sourceRef: "singleton",
      attributes: {
        schemaMigration: runtime?.schema_migration ?? null,
        appVersion: runtime?.app_version ?? null,
        workerVersion: runtime?.worker_version ?? null,
      },
      evidence: { updatedAt: runtime?.updated_at ?? null },
      observationKind: "observed",
    });
    addEdge(edges, { fromNodeKey: envKey, toNodeKey: runtimeKey, relationship: "runs_on", sourceType: "workspace_environments" });

    const migrationKey = "migration:cms-runtime";
    addNode(nodes, {
      nodeKey: migrationKey,
      nodeType: "migration",
      displayName: "CMS Migration Level",
      state: runtime?.schema_migration ? "present" : "unverified",
      sourceEntityType: "cms_runtime_state",
      sourceEntityId: "singleton",
      sourceType: "cms_runtime_state",
      attributes: { migration: runtime?.schema_migration ?? null },
      evidence: { migration: runtime?.schema_migration ?? null },
      observationKind: "observed",
    });
    addEdge(edges, { fromNodeKey: runtimeKey, toNodeKey: migrationKey, relationship: "depends_on", sourceType: "cms_runtime_state" });

    if (secretProvider) {
      const secretKey = `secret-provider:${secretProvider.id}`;
      addNode(nodes, {
        nodeKey: secretKey,
        nodeType: "secret_provider",
        displayName: secretProvider.name,
        state: secretProvider.status === "active" ? "present" : secretProvider.status === "degraded" ? "degraded" : "unverified",
        provider: secretProvider.provider_kind,
        capabilityKey: "secret_store",
        sourceEntityType: "workspace_secret_provider",
        sourceEntityId: secretProvider.id,
        sourceType: "workspace_secret_providers",
        sourceRef: secretProvider.id,
        attributes: { providerKind: secretProvider.provider_kind, status: secretProvider.status },
        evidence: { updatedAt: secretProvider.updated_at },
        observationKind: "declared",
      });
      addEdge(edges, { fromNodeKey: envKey, toNodeKey: secretKey, relationship: "governed_by", sourceType: "workspace_environments" });
    }

    for (const component of components ?? []) {
      const componentKey = `component:${component.component_key}`;
      addNode(nodes, {
        nodeKey: componentKey,
        nodeType: component.component_key === "delivery-worker" ? "worker" : component.component_key === "scheduler" ? "scheduler" : "component",
        displayName: component.component_key,
        state: stateFromComponent(component.state),
        provider: component.provider,
        capabilityKey: component.capability_key,
        sourceEntityType: "environment_component",
        sourceEntityId: component.id,
        sourceType: "environment_components",
        sourceRef: component.id,
        attributes: {
          required: component.required,
          currentVersion: component.current_version,
          requiredVersion: component.required_version,
          componentState: component.state,
          metadata: component.metadata_json ?? {},
        },
        evidence: { lastCheckedAt: component.last_checked_at, lastDeployedAt: component.last_deployed_at, lastError: component.last_error },
        observationKind: "observed",
      });
      addEdge(edges, { fromNodeKey: envKey, toNodeKey: componentKey, relationship: component.required ? "requires" : "depends_on", sourceType: "environment_components", sourceRef: component.id });
      addEdge(edges, { fromNodeKey: componentKey, toNodeKey: runtimeKey, relationship: "deployed_as", sourceType: "environment_components", sourceRef: component.id });
    }

    for (const connection of connections) {
      const connectionKey = `connection:${connection.id}`;
      const nodeType = connection.connector_family === "database" ? "database" : connection.connector_family === "storage" ? "storage" : connection.connector_family === "analytics" ? "analytics" : connection.connector_family === "search" ? "search" : connection.connector_family === "website" || connection.connector_family === "webhook" ? "website" : "connection";
      addNode(nodes, {
        nodeKey: connectionKey,
        nodeType,
        displayName: connection.name,
        state: stateFromConnection(connection.status, connection.active),
        provider: connection.connector_type,
        capabilityKey: connection.connector_family,
        sourceEntityType: "workspace_connection",
        sourceEntityId: connection.id,
        sourceType: "workspace_connections",
        sourceRef: connection.id,
        attributes: {
          connectorType: connection.connector_type,
          family: connection.connector_family,
          status: connection.status,
          active: connection.active,
          configKeys: Object.keys(connection.config_json ?? {}).sort(),
          metadata: connection.metadata_json ?? {},
        },
        evidence: { lastVerifiedAt: connection.last_verified_at, lastSuccessAt: connection.last_success_at },
        observationKind: "observed",
      });
      const relationship = connection.connector_family === "storage" ? "stores_in" : connection.connector_family === "analytics" ? "measured_by" : connection.connector_family === "website" || connection.connector_family === "webhook" ? "publishes_to" : "connects_to";
      addEdge(edges, { fromNodeKey: envKey, toNodeKey: connectionKey, relationship, sourceType: "workspace_connections", sourceRef: connection.id });
    }

    if (deepPostgres) {
      for (const node of deepPostgres.nodes) addNode(nodes, node);
      for (const edge of deepPostgres.edges) addEdge(edges, edge);
      if (deepPostgres.connectionId) {
        addNode(nodes, {
          nodeKey: `database-introspection:${deepPostgres.connectionId}`,
          nodeType: "database",
          displayName: "PostgreSQL introspection evidence",
          state: deepPostgres.supported ? "present" : "unverified",
          provider: deepPostgres.provider,
          capabilityKey: "schema_introspection",
          sourceEntityType: "workspace_connection",
          sourceEntityId: deepPostgres.connectionId,
          sourceType: "postgres_catalog",
          sourceRef: deepPostgres.connectionId,
          attributes: { database: deepPostgres.database, capabilityStates: deepPostgres.capabilityStates, inventoryCounts: deepPostgres.safeEvidence.inventoryCounts ?? {} },
          evidence: deepPostgres.safeEvidence,
          observationKind: "observed",
          validForSeconds: 10 * 60,
        });
        addEdge(edges, { fromNodeKey: `connection:${deepPostgres.connectionId}`, toNodeKey: `database-introspection:${deepPostgres.connectionId}`, relationship: "maps_to", sourceType: "postgres_catalog", sourceRef: deepPostgres.connectionId, observationKind: "observed", validForSeconds: 10 * 60 });
      }
    } else if (deepPostgresError) {
      addNode(nodes, {
        nodeKey: "database-introspection:error",
        nodeType: "database",
        displayName: "PostgreSQL introspection",
        state: "degraded",
        capabilityKey: "schema_introspection",
        sourceType: "postgres_catalog",
        attributes: { error: deepPostgresError },
        evidence: { safeError: deepPostgresError },
        observationKind: "observed",
        validForSeconds: 5 * 60,
      });
      addEdge(edges, { fromNodeKey: envKey, toNodeKey: "database-introspection:error", relationship: "depends_on", sourceType: "postgres_catalog", observationKind: "observed", validForSeconds: 5 * 60 });
    }

    if (providerCapabilities) {
      for (const node of providerCapabilities.nodes) addNode(nodes, node);
      for (const edge of providerCapabilities.edges) addEdge(edges, edge);
    } else if (providerCapabilitiesError) {
      addNode(nodes, { nodeKey: "other:provider-capability-discovery", nodeType: "other", displayName: "Provider capability discovery", state: "degraded", capabilityKey: "provider_capability_discovery", sourceType: "provider_capability_discovery", attributes: { error: providerCapabilitiesError }, evidence: { safeError: providerCapabilitiesError }, observationKind: "observed", validForSeconds: 5 * 60 });
      addEdge(edges, { fromNodeKey: envKey, toNodeKey: "other:provider-capability-discovery", relationship: "depends_on", sourceType: "provider_capability_discovery", observationKind: "observed", validForSeconds: 5 * 60 });
    }

    const latestSchemaByModel = new Map<string, any>();
    for (const row of schemaRows) if (!latestSchemaByModel.has(row.content_model_id)) latestSchemaByModel.set(row.content_model_id, row);
    for (const model of models) {
      const modelKey = `model:${model.id}`;
      const deployment = latestSchemaByModel.get(model.id) ?? null;
      const schemaKey = `schema:${model.id}`;
      addNode(nodes, {
        nodeKey: modelKey,
        nodeType: "model",
        displayName: model.name || model.api_key,
        state: "present",
        sourceEntityType: "content_model",
        sourceEntityId: model.id,
        sourceType: "content_models",
        sourceRef: model.id,
        attributes: { apiKey: model.api_key, currentSchemaVersion: model.current_schema_version },
        observationKind: "declared",
      });
      addNode(nodes, {
        nodeKey: schemaKey,
        nodeType: "schema",
        displayName: `${model.api_key} schema`,
        state: !deployment ? "missing" : deployment.status === "failed" ? "degraded" : deployment.schema_version === model.current_schema_version ? "present" : "outdated",
        sourceEntityType: "environment_schema_deployment",
        sourceEntityId: deployment?.id ?? null,
        sourceType: "environment_schema_deployments",
        sourceRef: deployment?.id ?? null,
        attributes: {
          modelId: model.id,
          apiKey: model.api_key,
          canonicalVersion: model.current_schema_version,
          deployedVersion: deployment?.schema_version ?? null,
          deployedHash: deployment?.schema_hash ?? null,
          deploymentStatus: deployment?.status ?? "missing",
        },
        evidence: { deployedAt: deployment?.deployed_at ?? null, metadata: deployment?.metadata_json ?? {} },
        observationKind: "observed",
      });
      addEdge(edges, { fromNodeKey: envKey, toNodeKey: modelKey, relationship: "requires", sourceType: "content_models", sourceRef: model.id });
      addEdge(edges, { fromNodeKey: modelKey, toNodeKey: schemaKey, relationship: "deployed_as", sourceType: "environment_schema_deployments", sourceRef: deployment?.id ?? null });
      addEdge(edges, { fromNodeKey: schemaKey, toNodeKey: migrationKey, relationship: "depends_on", sourceType: "environment_schema_deployments", sourceRef: deployment?.id ?? null });
    }

    for (const website of websites) {
      const websiteKey = `website-binding:${website.id}`;
      addNode(nodes, {
        nodeKey: websiteKey,
        nodeType: "website",
        displayName: `Website binding · ${website.integration_method}`,
        state: website.status === "active" ? "present" : website.status === "failed" || website.status === "degraded" ? "degraded" : "unverified",
        provider: website.integration_method,
        sourceEntityType: "website_connection_binding",
        sourceEntityId: website.id,
        sourceType: "website_connection_bindings",
        sourceRef: website.id,
        attributes: { status: website.status, connectionId: website.connection_id, publicationTargetId: website.publication_target_id, integrationMethod: website.integration_method },
        evidence: { lastTestAt: website.last_test_at, lastError: website.last_error },
        observationKind: "observed",
      });
      addEdge(edges, { fromNodeKey: envKey, toNodeKey: websiteKey, relationship: "publishes_to", sourceType: "website_connection_bindings", sourceRef: website.id });
      if (website.connection_id) addEdge(edges, { fromNodeKey: websiteKey, toNodeKey: `connection:${website.connection_id}`, relationship: "connects_to", sourceType: "website_connection_bindings", sourceRef: website.id });
    }

    const latestBackup = backups[0];
    if (latestBackup) {
      const backupKey = `backup:${latestBackup.id}`;
      addNode(nodes, {
        nodeKey: backupKey,
        nodeType: "backup",
        displayName: "Latest workspace backup",
        state: latestBackup.status === "verified" ? "present" : latestBackup.status === "failed" ? "degraded" : "unverified",
        sourceEntityType: "workspace_backup",
        sourceEntityId: latestBackup.id,
        sourceType: "workspace_backups",
        sourceRef: latestBackup.id,
        attributes: { status: latestBackup.status, checksumSha256: latestBackup.checksum_sha256 },
        evidence: { createdAt: latestBackup.created_at, verifiedAt: latestBackup.verified_at },
        observationKind: "observed",
        validForSeconds: 24 * 60 * 60,
      });
      addEdge(edges, { fromNodeKey: envKey, toNodeKey: backupKey, relationship: "governed_by", sourceType: "workspace_backups", sourceRef: latestBackup.id, validForSeconds: 24 * 60 * 60 });
    }

    if (doctor) {
      addNode(nodes, {
        nodeKey: "other:system-doctor",
        nodeType: "other",
        displayName: "System Doctor evidence",
        state: doctor.status === "healthy" ? "healthy" : doctor.status === "blocked" ? "blocked" : doctor.status === "warning" ? "degraded" : "unknown",
        sourceEntityType: "system_doctor_run",
        sourceEntityId: doctor.id,
        sourceType: "system_doctor_runs",
        sourceRef: doctor.id,
        attributes: { status: doctor.status, summary: doctor.summary_json ?? {} },
        evidence: { checkedAt: doctor.checked_at },
        observationKind: "observed",
      });
      addEdge(edges, { fromNodeKey: envKey, toNodeKey: "other:system-doctor", relationship: "governed_by", sourceType: "system_doctor_runs", sourceRef: doctor.id });
    }

    for (const sync of syncStates) {
      const key = `analytics-sync:${sync.connector_id}`;
      addNode(nodes, {
        nodeKey: key,
        nodeType: "analytics",
        displayName: "Analytics synchronization",
        state: sync.status === "fresh" ? "healthy" : sync.status === "failed" || sync.status === "stale" ? "degraded" : "unverified",
        sourceEntityType: "analytics_sync_state",
        sourceEntityId: sync.connector_id,
        sourceType: "analytics_sync_state",
        sourceRef: sync.connector_id,
        attributes: { status: sync.status, freshThrough: sync.fresh_through },
        evidence: { lastSuccessAt: sync.last_success_at, lastError: sync.last_error, updatedAt: sync.updated_at },
        observationKind: "observed",
      });
      addEdge(edges, { fromNodeKey: envKey, toNodeKey: key, relationship: "measured_by", sourceType: "analytics_sync_state", sourceRef: sync.connector_id });
      if (connections.some((connection) => connection.id === sync.connector_id)) addEdge(edges, { fromNodeKey: key, toNodeKey: `connection:${sync.connector_id}`, relationship: "connects_to", sourceType: "analytics_sync_state", sourceRef: sync.connector_id });
    }

    const nodeRows = nodes.map((node) => ({
      workspace_id: params.workspaceId,
      environment_id: params.environmentId,
      node_key: node.nodeKey,
      node_type: node.nodeType,
      provider: node.provider ?? null,
      capability_key: node.capabilityKey ?? null,
      display_name: node.displayName,
      state: node.state,
      attributes_json: node.attributes ?? {},
      source_entity_type: node.sourceEntityType ?? null,
      source_entity_id: node.sourceEntityId ?? null,
      last_observed_at: startedAt,
      valid_until: validUntil(node.validForSeconds),
      is_stale: false,
      updated_at: startedAt,
    }));
    const { data: persistedNodes, error: nodesError } = await db.from("operational_world_nodes").upsert(nodeRows, { onConflict: "workspace_id,environment_id,node_key" }).select("id,node_key");
    if (nodesError) throw new Error(nodesError.message);
    const nodeIdByKey = new Map((persistedNodes ?? []).map((row) => [row.node_key, row.id]));

    const observationRows = nodes.map((node) => ({
      workspace_id: params.workspaceId,
      environment_id: params.environmentId,
      discovery_run_id: run.id,
      node_id: nodeIdByKey.get(node.nodeKey),
      fact_key: "node.state",
      observation_kind: node.observationKind ?? "observed",
      source_type: node.sourceType,
      source_ref: node.sourceRef ?? null,
      value_json: { state: node.state, provider: node.provider ?? null, capabilityKey: node.capabilityKey ?? null, attributes: node.attributes ?? {} },
      evidence_json: node.evidence ?? {},
      confidence: node.confidence ?? null,
      observed_at: startedAt,
      valid_until: validUntil(node.validForSeconds),
    }));
    if (observationRows.length) {
      const { error } = await db.from("operational_observations").insert(observationRows);
      if (error) throw new Error(error.message);
    }

    const edgeRows = edges
      .map((edge) => ({ edge, from: nodeIdByKey.get(edge.fromNodeKey), to: nodeIdByKey.get(edge.toNodeKey) }))
      .filter((item) => item.from && item.to)
      .map(({ edge, from, to }) => ({
        workspace_id: params.workspaceId,
        environment_id: params.environmentId,
        from_node_id: from,
        to_node_id: to,
        relationship: edge.relationship,
        attributes_json: edge.attributes ?? {},
        last_observed_at: startedAt,
        valid_until: validUntil(edge.validForSeconds),
        is_stale: false,
      }));
    const { data: persistedEdges, error: edgesError } = edgeRows.length
      ? await db.from("operational_world_edges").upsert(edgeRows, { onConflict: "environment_id,from_node_id,to_node_id,relationship" }).select("id,from_node_id,to_node_id,relationship")
      : { data: [], error: null };
    if (edgesError) throw new Error(edgesError.message);

    if (persistedEdges?.length) {
      const edgeSeedByIdentity = new Map(edges.map((edge) => [`${nodeIdByKey.get(edge.fromNodeKey)}:${nodeIdByKey.get(edge.toNodeKey)}:${edge.relationship}`, edge]));
      const edgeObservationRows = persistedEdges.map((edge) => {
        const seed = edgeSeedByIdentity.get(`${edge.from_node_id}:${edge.to_node_id}:${edge.relationship}`)!;
        return {
          workspace_id: params.workspaceId,
          environment_id: params.environmentId,
          discovery_run_id: run.id,
          edge_id: edge.id,
          fact_key: "edge.relationship",
          observation_kind: seed.observationKind ?? "observed",
          source_type: seed.sourceType,
          source_ref: seed.sourceRef ?? null,
          value_json: { relationship: seed.relationship, attributes: seed.attributes ?? {} },
          evidence_json: seed.evidence ?? {},
          confidence: seed.confidence ?? null,
          observed_at: startedAt,
          valid_until: validUntil(seed.validForSeconds),
        };
      });
      const { error } = await db.from("operational_observations").insert(edgeObservationRows);
      if (error) throw new Error(error.message);
    }

    await db.from("operational_world_nodes").update({ is_stale: true }).eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).lt("last_observed_at", startedAt);
    await db.from("operational_world_edges").update({ is_stale: true }).eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).lt("last_observed_at", startedAt);

    const summary = {
      nodes: nodeRows.length,
      edges: edgeRows.length,
      staleNodesExcluded: true,
      observationTtlSeconds: DEFAULT_OBSERVATION_TTL_SECONDS,
      environmentStatus: environment.status,
      doctorStatus: doctor?.status ?? null,
      deepPostgres: deepPostgres ? { supported: deepPostgres.supported, connectionId: deepPostgres.connectionId, capabilityStates: deepPostgres.capabilityStates, inventoryCounts: deepPostgres.safeEvidence.inventoryCounts ?? {} } : { supported: false, error: deepPostgresError },
      providerCapabilities: providerCapabilities ? providerCapabilities.summary : { storageConnections: 0, storageProbed: 0, declaredContracts: 0, contractsProbed: 0, runtimeCapabilities: 0, warnings: providerCapabilitiesError ? [{ capability: "provider_discovery", message: providerCapabilitiesError }] : [] },
    };
    const { data: completed, error: completeError } = await db.from("operational_discovery_runs").update({ status: "succeeded", completed_at: new Date().toISOString(), summary_json: summary }).eq("id", run.id).select().single();
    if (completeError || !completed) throw new Error(completeError?.message || "Could not complete operational discovery");
    return { run: completed, nodes: persistedNodes ?? [], edges: persistedEdges ?? [], summary };
  } catch (error) {
    await db.from("operational_discovery_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_json: { message: error instanceof Error ? error.message : "Operational discovery failed" },
    }).eq("id", run.id);
    throw error;
  }
}

export async function getOperationalWorldModel(workspaceId: string, environmentId: string) {
  const db = createServiceRoleClient();
  const [nodes, edges, latestDiscovery] = await Promise.all([
    db.from("operational_world_nodes").select("*").eq("workspace_id", workspaceId).eq("environment_id", environmentId).order("node_type").order("node_key"),
    db.from("operational_world_edges").select("*").eq("workspace_id", workspaceId).eq("environment_id", environmentId).order("relationship"),
    db.from("operational_discovery_runs").select("*").eq("workspace_id", workspaceId).eq("environment_id", environmentId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return { nodes: nodes.data ?? [], edges: edges.data ?? [], latestDiscovery: latestDiscovery.data ?? null };
}

export async function buildGeneratedDesiredState(workspaceId: string, environmentId: string): Promise<OperationalDesiredState> {
  const db = createServiceRoleClient();
  const [environmentResult, componentsResult, connectionsResult, modelsResult, schemasResult, runtimeResult, websitesResult] = await Promise.all([
    db.from("workspace_environments").select("id,status,kind").eq("workspace_id", workspaceId).eq("id", environmentId).maybeSingle(),
    db.from("environment_components").select("component_key,capability_key,required,provider,state").eq("workspace_id", workspaceId).eq("environment_id", environmentId),
    db.from("workspace_connections").select("id,connector_type,connector_family,status,active").eq("workspace_id", workspaceId).eq("environment_id", environmentId),
    db.from("content_models").select("id,api_key,current_schema_version,status").eq("workspace_id", workspaceId).eq("status", "active"),
    db.from("environment_schema_deployments").select("content_model_id,schema_version,schema_hash,deployed_at").eq("workspace_id", workspaceId).eq("environment_id", environmentId).order("deployed_at", { ascending: false }),
    db.from("cms_runtime_state").select("schema_migration,app_version,worker_version").eq("singleton", true).maybeSingle(),
    db.from("website_connection_bindings").select("id,status").eq("workspace_id", workspaceId).eq("environment_id", environmentId),
  ]);
  const environment = environmentResult.data;
  if (!environment) throw Object.assign(new Error("Environment not found"), { status: 404 });

  const components: OperationalDesiredState["capabilities"] = {};
  for (const component of componentsResult.data ?? []) {
    if (!component.required && component.state === "unsupported") continue;
    components[component.component_key] = { state: "present", required: Boolean(component.required), provider: component.provider ?? null };
  }

  const connections: OperationalDesiredState["connections"] = {};
  for (const connection of connectionsResult.data ?? []) {
    if (!connection.active || connection.status === "disabled") continue;
    connections[connection.id] = { status: "active", connectorType: connection.connector_type, family: connection.connector_family };
  }

  const latestSchemaByModel = new Map<string, any>();
  for (const row of schemasResult.data ?? []) if (!latestSchemaByModel.has(row.content_model_id)) latestSchemaByModel.set(row.content_model_id, row);
  const schemas: OperationalDesiredState["schemas"] = {};
  for (const model of modelsResult.data ?? []) {
    const deployed = latestSchemaByModel.get(model.id);
    schemas[model.id] = { version: model.current_schema_version, hash: deployed?.schema_version === model.current_schema_version ? deployed.schema_hash ?? null : null, apiKey: model.api_key };
  }

  const websites: OperationalDesiredState["websites"] = {};
  for (const website of websitesResult.data ?? []) websites[website.id] = { status: "active" };

  return {
    schemaVersion: 1,
    environment: { status: "ready" },
    capabilities: components,
    connections,
    schemas,
    runtime: {
      migration: runtimeResult.data?.schema_migration ?? null,
      appVersion: runtimeResult.data?.app_version ?? null,
      workerVersion: runtimeResult.data?.worker_version ?? null,
    },
    websites,
    metadata: { generatedAt: new Date().toISOString(), environmentKind: environment.kind, source: "canonical-controller-baseline" },
  };
}
