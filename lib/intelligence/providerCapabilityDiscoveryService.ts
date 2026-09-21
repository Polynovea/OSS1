import { createHash, randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { redactCredentials, resolveConnectionCredentials } from "@/lib/infrastructure/credentialProvider";
import { assertSafeOutboundUrl, safeFetch } from "@/lib/infrastructure/networkSafety";
import type { EnvironmentKind } from "@/lib/infrastructure/types";
import type { OperationalCapabilityState, OperationalWorldEdgeSeed, OperationalWorldNodeSeed } from "@/lib/intelligence/operationalTypes";

export interface ProviderCapabilityDiscovery {
  nodes: OperationalWorldNodeSeed[];
  edges: OperationalWorldEdgeSeed[];
  summary: {
    storageConnections: number;
    storageProbed: number;
    declaredContracts: number;
    contractsProbed: number;
    runtimeCapabilities: number;
    warnings: Array<{ connectionId?: string; capability: string; message: string }>;
  };
}

type ConnectionRow = {
  id: string;
  name: string;
  connector_type: string;
  connector_family: string;
  status: string;
  active: boolean;
  config_json: Record<string, unknown> | null;
  metadata_json: Record<string, unknown> | null;
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const capabilityState = (okay: boolean | null, unsupported = false): OperationalCapabilityState => unsupported ? "unsupported" : okay === true ? "present" : okay === false ? "missing" : "unverified";

function safeError(error: unknown, credentials: Record<string, string>) {
  return redactCredentials(error instanceof Error ? error.message : String(error), credentials).slice(0, 1000);
}

async function capabilityProbe<T>(fn: () => Promise<T>): Promise<{ state: "present" | "missing" | "unverified" | "unsupported"; value?: T; note?: string }> {
  try {
    return { state: "present", value: await fn() };
  } catch (error: any) {
    const name = String(error?.name ?? "");
    const code = String(error?.Code ?? error?.code ?? "");
    const message = String(error?.message ?? "");
    if (/NoSuch|NotFound|NoSuchLifecycleConfiguration|NoSuchCORSConfiguration/i.test(`${name} ${code} ${message}`)) return { state: "missing", note: name || code || "not configured" };
    if (/NotImplemented|Unsupported|501/i.test(`${name} ${code} ${message}`)) return { state: "unsupported", note: name || code || "unsupported" };
    if (/AccessDenied|Forbidden|Unauthorized|403|permission/i.test(`${name} ${code} ${message}`)) return { state: "unverified", note: "permission does not allow capability inspection" };
    return { state: "unverified", note: message.slice(0, 300) || "capability probe failed" };
  }
}

async function discoverS3Like(connection: ConnectionRow, credentials: Record<string, string>, environmentKind: EnvironmentKind) {
  const config = connection.config_json ?? {};
  const kind = connection.connector_type === "storage.r2" ? "r2" : connection.connector_type === "storage.minio" ? "minio" : "s3";
  const bucket = text(config.bucket);
  let region = text(config.region) || "us-east-1";
  let endpoint = text(config.endpoint) || undefined;
  let forcePathStyle = false;
  const accessKeyId = credentials.access_key_id || text(config.accessKeyId);
  const secretAccessKey = credentials.secret_access_key;
  if (kind === "r2") {
    const accountId = text(config.accountId);
    endpoint = endpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
    region = "auto";
  }
  if (kind === "minio") forcePathStyle = true;
  if (!bucket || !accessKeyId || !secretAccessKey) throw new Error("Storage bucket and credential bindings are incomplete");
  if (endpoint) await assertSafeOutboundUrl(endpoint, environmentKind, { allowHttpLocal: true });

  const {
    S3Client,
    HeadBucketCommand,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    CreateMultipartUploadCommand,
    AbortMultipartUploadCommand,
    GetBucketVersioningCommand,
    GetBucketLifecycleConfigurationCommand,
    GetBucketCorsCommand,
  } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const client = new S3Client({ region, endpoint, forcePathStyle, credentials: { accessKeyId, secretAccessKey } });
  await client.send(new HeadBucketCommand({ Bucket: bucket }));

  const probeKey = `.polynovea-capability/${randomUUID()}.txt`;
  const probeBody = `polynovea-capability:${randomUUID()}`;
  let multipartUploadId: string | undefined;
  const evidence: Record<string, unknown> = {
    provider: kind,
    bucket,
    region,
    endpointOrigin: endpoint ? new URL(endpoint).origin : null,
    publicReadUrlDeclared: Boolean(text(config.publicUrl)),
    disposableArtifactRetained: false,
  };
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: probeKey, Body: probeBody, ContentType: "text/plain", Metadata: { "polynovea-probe": "capability" } }));
    const downloaded = await client.send(new GetObjectCommand({ Bucket: bucket, Key: probeKey }));
    const received = downloaded.Body ? await downloaded.Body.transformToString() : "";
    if (received !== probeBody) throw new Error("Storage disposable read-back did not match the written probe");
    evidence.roundTrip = "passed";
    evidence.metadataRoundTrip = downloaded.Metadata?.["polynovea-probe"] === "capability" ? "passed" : "unverified";

    const signed = await capabilityProbe(async () => {
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: probeKey }), { expiresIn: 60 });
      const response = await safeFetch(url, environmentKind, { method: "GET", signal: AbortSignal.timeout(10_000) }, 0);
      if (!response.ok) throw new Error(`signed URL returned HTTP ${response.status}`);
      const body = await response.text();
      if (body !== probeBody) throw new Error("signed URL read-back did not match disposable probe");
      return true;
    });
    evidence.signedUrl = signed.state;

    const multipart = await capabilityProbe(async () => {
      const created = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: probeKey + ".multipart", ContentType: "application/octet-stream" }));
      multipartUploadId = created.UploadId;
      if (!multipartUploadId) throw new Error("multipart upload did not return an upload identifier");
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: probeKey + ".multipart", UploadId: multipartUploadId }));
      multipartUploadId = undefined;
      return true;
    });
    evidence.multipart = multipart.state;

    const versioning = await capabilityProbe(() => client.send(new GetBucketVersioningCommand({ Bucket: bucket })));
    evidence.versioning = versioning.state === "present" ? (versioning.value?.Status ?? "available_not_enabled") : versioning.state;
    const lifecycle = await capabilityProbe(() => client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })));
    evidence.lifecycle = lifecycle.state;
    const cors = await capabilityProbe(() => client.send(new GetBucketCorsCommand({ Bucket: bucket })));
    evidence.cors = cors.state;
  } finally {
    if (multipartUploadId) await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: probeKey + ".multipart", UploadId: multipartUploadId })).catch(() => undefined);
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: probeKey })).catch(() => undefined);
  }
  return evidence;
}

async function discoverSupabaseStorage(connection: ConnectionRow, credentials: Record<string, string>, environmentKind: EnvironmentKind) {
  const config = connection.config_json ?? {};
  const projectUrl = text(config.projectUrl);
  const bucket = text(config.bucket);
  const key = credentials.service_role_key || credentials.anon_key;
  if (!projectUrl || !bucket || !key) throw new Error("Supabase Storage project, bucket and credential are required");
  await assertSafeOutboundUrl(projectUrl, environmentKind, { allowHttpLocal: true });
  const headers = { apikey: key, authorization: `Bearer ${key}` };
  const list = await safeFetch(new URL("/storage/v1/bucket", projectUrl).toString(), environmentKind, { method: "GET", headers, signal: AbortSignal.timeout(10_000) });
  if (!list.ok) throw new Error(`Supabase Storage bucket discovery returned HTTP ${list.status}`);
  const buckets = await list.json().catch(() => []) as Array<Record<string, unknown>>;
  const bucketRow = buckets.find((item) => text(item.name) === bucket || text(item.id) === bucket);
  if (!bucketRow) throw new Error(`Supabase Storage bucket ${bucket} was not found`);

  const probePath = `.polynovea-capability/${randomUUID()}.txt`;
  const probeBody = `polynovea-capability:${randomUUID()}`;
  const evidence: Record<string, unknown> = {
    provider: "supabase-storage",
    bucket,
    projectOrigin: new URL(projectUrl).origin,
    visibility: bucketRow.public === true || text(config.visibility) === "public" ? "public" : "private",
    fileSizeLimit: bucketRow.file_size_limit ?? null,
    allowedMimeTypesConfigured: Array.isArray(bucketRow.allowed_mime_types) ? bucketRow.allowed_mime_types.length : 0,
    publicReadUrlDeclared: Boolean(text(config.publicUrl)),
    multipart: "unverified",
    lifecycle: "unverified",
    cors: "provider_managed_or_unverified",
    disposableArtifactRetained: false,
  };
  try {
    const upload = await safeFetch(new URL(`/storage/v1/object/${encodeURIComponent(bucket)}/${probePath}`, projectUrl).toString(), environmentKind, { method: "POST", headers: { ...headers, "content-type": "text/plain", "x-upsert": "true" }, body: probeBody, signal: AbortSignal.timeout(10_000) });
    if (!upload.ok) throw new Error(`Supabase Storage disposable upload returned HTTP ${upload.status}`);
    const read = await safeFetch(new URL(`/storage/v1/object/${encodeURIComponent(bucket)}/${probePath}`, projectUrl).toString(), environmentKind, { method: "GET", headers, signal: AbortSignal.timeout(10_000) });
    if (!read.ok || await read.text() !== probeBody) throw new Error(`Supabase Storage disposable read-back failed with HTTP ${read.status}`);
    evidence.roundTrip = "passed";

    const signed = await capabilityProbe(async () => {
      const response = await safeFetch(new URL(`/storage/v1/object/sign/${encodeURIComponent(bucket)}/${probePath}`, projectUrl).toString(), environmentKind, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: 60 }), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`signed URL capability returned HTTP ${response.status}`);
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!text(payload.signedURL) && !text(payload.signedUrl)) throw new Error("signed URL capability returned no URL");
      return true;
    });
    evidence.signedUrl = signed.state;
  } finally {
    await safeFetch(new URL(`/storage/v1/object/${encodeURIComponent(bucket)}`, projectUrl).toString(), environmentKind, { method: "DELETE", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ prefixes: [probePath] }), signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  }
  return evidence;
}

function contractHeaders(config: Record<string, unknown>, credentials: Record<string, string>) {
  const headers = new Headers({ "user-agent": "Polynovea-CMS-Contract-Discovery/1.0", accept: "application/json" });
  if (credentials.bearer_token) headers.set("authorization", `Bearer ${credentials.bearer_token}`);
  if (credentials.api_key) {
    const header = text(config.apiKeyHeader) || "x-api-key";
    if (/^[A-Za-z0-9-]{1,64}$/.test(header)) headers.set(header, credentials.api_key);
  }
  return headers;
}

async function discoverDeclaredContract(connection: ConnectionRow, credentials: Record<string, string>, environmentKind: EnvironmentKind, bindingMethods: string[]) {
  const config = connection.config_json ?? {};
  const baseUrl = text(config.baseUrl) || text(config.endpointUrl);
  let kind = text(config.contractKind).toLowerCase();
  let target = text(config.contractUrl);
  if (!kind && bindingMethods.includes("wordpress")) kind = "wordpress";
  if (!target && kind === "wordpress" && baseUrl) target = new URL("/wp-json", baseUrl).toString();
  if (!target) return null;
  if (!kind) kind = "openapi";
  const headers = contractHeaders(config, credentials);
  await assertSafeOutboundUrl(target, environmentKind, { allowHttpLocal: true });

  if (kind === "graphql") {
    headers.set("content-type", "application/json");
    const query = "query PolynoveaCapabilityIntrospection { __schema { queryType { name } mutationType { name } subscriptionType { name } types { kind name } } }";
    const response = await safeFetch(target, environmentKind, { method: "POST", headers, body: JSON.stringify({ query }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`GraphQL introspection returned HTTP ${response.status}`);
    const payload = await response.json() as any;
    const schema = payload?.data?.__schema;
    if (!schema) throw new Error("GraphQL introspection response did not contain __schema");
    const typeNames = (schema.types ?? []).map((item: any) => text(item.name)).filter(Boolean).slice(0, 200);
    return { kind: "graphql", contractOrigin: new URL(target).origin, queryType: schema.queryType?.name ?? null, mutationType: schema.mutationType?.name ?? null, subscriptionType: schema.subscriptionType?.name ?? null, typeCount: Array.isArray(schema.types) ? schema.types.length : 0, typeNames, checksumSha256: sha256(schema) };
  }

  const response = await safeFetch(target, environmentKind, { method: "GET", headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${kind} contract discovery returned HTTP ${response.status}`);
  const payload = await response.json().catch(() => null) as any;
  if (!payload || typeof payload !== "object") throw new Error("Declared contract is not valid JSON");

  if (kind === "wordpress") {
    const routes = payload.routes && typeof payload.routes === "object" ? Object.keys(payload.routes) : [];
    return { kind: "wordpress", contractOrigin: new URL(target).origin, namespaces: Array.isArray(payload.namespaces) ? payload.namespaces.slice(0, 100) : [], routeCount: routes.length, routes: routes.slice(0, 200), checksumSha256: sha256({ namespaces: payload.namespaces ?? [], routes }) };
  }
  if (kind === "polynovea") {
    const capabilityKeys = payload.capabilities && typeof payload.capabilities === "object" ? Object.keys(payload.capabilities) : [];
    const endpointKeys = payload.endpoints && typeof payload.endpoints === "object" ? Object.keys(payload.endpoints) : [];
    return { kind: "polynovea", contractOrigin: new URL(target).origin, version: payload.version ?? null, capabilityKeys: capabilityKeys.slice(0, 200), endpointKeys: endpointKeys.slice(0, 200), checksumSha256: sha256(payload) };
  }

  const paths = payload.paths && typeof payload.paths === "object" ? Object.entries(payload.paths) : [];
  if (!payload.openapi && !payload.swagger && !paths.length) throw new Error("Declared OpenAPI contract has no openapi/swagger marker or paths");
  const normalized = paths.slice(0, 300).map(([path, operations]: [string, any]) => ({ path, methods: operations && typeof operations === "object" ? Object.keys(operations).filter((method) => ["get", "post", "put", "patch", "delete", "head", "options"].includes(method.toLowerCase())).sort() : [] }));
  const operationCount = normalized.reduce((sum, item) => sum + item.methods.length, 0);
  const securitySchemes = payload.components?.securitySchemes && typeof payload.components.securitySchemes === "object" ? Object.keys(payload.components.securitySchemes) : [];
  return { kind: "openapi", contractOrigin: new URL(target).origin, openapi: payload.openapi ?? payload.swagger ?? null, title: payload.info?.title ?? null, version: payload.info?.version ?? null, pathCount: paths.length, operationCount, paths: normalized, securitySchemes: securitySchemes.slice(0, 100), checksumSha256: sha256({ openapi: payload.openapi ?? payload.swagger ?? null, info: payload.info ?? {}, paths: payload.paths ?? {}, securitySchemes }) };
}

function runtimeCapabilitySeeds(environment: any, components: any[], connections: ConnectionRow[]) {
  const nodes: OperationalWorldNodeSeed[] = [];
  const edges: OperationalWorldEdgeSeed[] = [];
  const envKey = `environment:${environment.id}`;
  const componentByKey = new Map(components.map((component) => [String(component.component_key), component]));
  const add = (key: string, displayName: string, state: OperationalCapabilityState, evidence: Record<string, unknown>, kind: "observed" | "declared" = "declared") => {
    const nodeKey = `runtime-capability:${key}`;
    nodes.push({ nodeKey, nodeType: "runtime", displayName, state, provider: environment.runtime_provider ?? null, capabilityKey: key, sourceEntityType: "workspace_environment", sourceEntityId: environment.id, sourceType: kind === "observed" ? "runtime_probe" : "workspace_environments", sourceRef: environment.id, attributes: evidence, evidence, observationKind: kind, validForSeconds: kind === "observed" ? 10 * 60 : 15 * 60 });
    edges.push({ fromNodeKey: envKey, toNodeKey: nodeKey, relationship: "requires", sourceType: kind === "observed" ? "runtime_probe" : "workspace_environments", sourceRef: environment.id, observationKind: kind, validForSeconds: kind === "observed" ? 10 * 60 : 15 * 60 });
  };

  add("public_http", "Public HTTP capability", environment.cms_base_url ? "present" : "unverified", { cmsBaseUrlDeclared: Boolean(environment.cms_base_url), source: "explicit_environment_topology" });
  const worker = componentByKey.get("delivery-worker");
  add("durable_worker", "Durable worker capability", worker && ["present", "supported"].includes(worker.state) ? "present" : worker?.state === "unsupported" ? "unsupported" : worker ? "degraded" : "unverified", { componentId: worker?.id ?? null, componentState: worker?.state ?? null }, "observed");
  const scheduler = componentByKey.get("scheduler");
  add("scheduled_execution", "Scheduled execution capability", scheduler && ["present", "supported"].includes(scheduler.state) ? "present" : scheduler?.state === "unsupported" ? "unsupported" : scheduler ? "degraded" : "unverified", { componentId: scheduler?.id ?? null, componentState: scheduler?.state ?? null }, "observed");
  const persistenceReady = connections.some((connection) => connection.active && ["database", "storage"].includes(connection.connector_family) && connection.status === "active");
  add("writable_persistence", "Writable persistence capability", persistenceReady ? "present" : "unverified", { activeDatabaseOrStorageConnection: persistenceReady });
  if (environment.kind === "local") {
    add("process_runtime", "Local process runtime", "present", { nodeVersion: process.version, platform: process.platform, arch: process.arch }, "observed");
  } else {
    add("process_runtime", "Remote process runtime", "unverified", { provider: environment.runtime_provider ?? null, reason: "remote runtime is not inferred from the control-plane process" });
  }
  add("provider_identity", "Runtime provider identity", environment.runtime_provider ? "present" : "unverified", { provider: environment.runtime_provider ?? null, source: environment.runtime_provider ? "explicit_topology" : "not_declared", metadataProbeUsed: false });
  return { nodes, edges };
}

export async function discoverProviderCapabilities(params: { workspaceId: string; environmentId: string }): Promise<ProviderCapabilityDiscovery> {
  const db = createServiceRoleClient();
  const [{ data: environment }, { data: connections }, { data: components }, { data: bindings }] = await Promise.all([
    db.from("workspace_environments").select("id,kind,status,cms_base_url,runtime_provider,database_provider,storage_provider").eq("workspace_id", params.workspaceId).eq("id", params.environmentId).maybeSingle(),
    db.from("workspace_connections").select("id,name,connector_type,connector_family,status,active,config_json,metadata_json").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId),
    db.from("environment_components").select("id,component_key,state,provider,capability_key,last_checked_at").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId),
    db.from("website_connection_bindings").select("id,connection_id,integration_method,status").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId),
  ]);
  if (!environment) throw Object.assign(new Error("Environment not found"), { status: 404 });
  const environmentKind = environment.kind as EnvironmentKind;
  const rows = (connections ?? []) as ConnectionRow[];
  const nodes: OperationalWorldNodeSeed[] = [];
  const edges: OperationalWorldEdgeSeed[] = [];
  const warnings: ProviderCapabilityDiscovery["summary"]["warnings"] = [];
  let storageProbed = 0;
  let contractsProbed = 0;
  let declaredContracts = 0;

  for (const connection of rows.filter((row) => row.active && row.connector_family === "storage")) {
    const key = `storage-capability:${connection.id}`;
    let credentials: Record<string, string> = {};
    try {
      credentials = await resolveConnectionCredentials(params.workspaceId, connection.id);
      const evidence = connection.connector_type === "storage.supabase"
        ? await discoverSupabaseStorage(connection, credentials, environmentKind)
        : ["storage.s3", "storage.r2", "storage.minio"].includes(connection.connector_type)
          ? await discoverS3Like(connection, credentials, environmentKind)
          : { provider: connection.connector_type, roundTrip: "unverified", reason: "no storage capability adapter" };
      storageProbed++;
      nodes.push({ nodeKey: key, nodeType: "storage", displayName: `${connection.name} capabilities`, state: evidence.roundTrip === "passed" ? "present" : "unverified", provider: connection.connector_type, capabilityKey: "storage_capabilities", sourceEntityType: "workspace_connection", sourceEntityId: connection.id, sourceType: "storage_capability_probe", sourceRef: connection.id, attributes: evidence, evidence, observationKind: "observed", validForSeconds: 10 * 60 });
    } catch (error) {
      const message = safeError(error, credentials);
      warnings.push({ connectionId: connection.id, capability: "storage", message });
      nodes.push({ nodeKey: key, nodeType: "storage", displayName: `${connection.name} capabilities`, state: "degraded", provider: connection.connector_type, capabilityKey: "storage_capabilities", sourceEntityType: "workspace_connection", sourceEntityId: connection.id, sourceType: "storage_capability_probe", sourceRef: connection.id, attributes: { error: message }, evidence: { safeError: message }, observationKind: "observed", validForSeconds: 5 * 60 });
    }
    edges.push({ fromNodeKey: `connection:${connection.id}`, toNodeKey: key, relationship: "maps_to", sourceType: "storage_capability_probe", sourceRef: connection.id, observationKind: "observed", validForSeconds: 10 * 60 });
  }

  const methodsByConnection = new Map<string, string[]>();
  for (const binding of bindings ?? []) methodsByConnection.set(binding.connection_id, [...(methodsByConnection.get(binding.connection_id) ?? []), binding.integration_method]);
  for (const connection of rows.filter((row) => row.active && ["website", "custom", "webhook"].includes(row.connector_family))) {
    const config = connection.config_json ?? {};
    const methods = methodsByConnection.get(connection.id) ?? [];
    const isDeclared = Boolean(text(config.contractUrl) || text(config.contractKind) || methods.includes("wordpress"));
    if (!isDeclared) continue;
    declaredContracts++;
    const key = `api-contract:${connection.id}`;
    let credentials: Record<string, string> = {};
    try {
      credentials = await resolveConnectionCredentials(params.workspaceId, connection.id);
      const contract = await discoverDeclaredContract(connection, credentials, environmentKind, methods);
      if (!contract) continue;
      contractsProbed++;
      nodes.push({ nodeKey: key, nodeType: "api", displayName: `${connection.name} contract`, state: "present", provider: connection.connector_type, capabilityKey: "machine_readable_contract", sourceEntityType: "workspace_connection", sourceEntityId: connection.id, sourceType: "declared_contract_probe", sourceRef: connection.id, attributes: contract, evidence: { ...contract, rawContractRetained: false }, observationKind: "observed", validForSeconds: 15 * 60 });
    } catch (error) {
      const message = safeError(error, credentials);
      warnings.push({ connectionId: connection.id, capability: "api_contract", message });
      nodes.push({ nodeKey: key, nodeType: "api", displayName: `${connection.name} contract`, state: "degraded", provider: connection.connector_type, capabilityKey: "machine_readable_contract", sourceEntityType: "workspace_connection", sourceEntityId: connection.id, sourceType: "declared_contract_probe", sourceRef: connection.id, attributes: { error: message }, evidence: { safeError: message }, observationKind: "observed", validForSeconds: 5 * 60 });
    }
    edges.push({ fromNodeKey: `connection:${connection.id}`, toNodeKey: key, relationship: "maps_to", sourceType: "declared_contract_probe", sourceRef: connection.id, observationKind: "observed", validForSeconds: 15 * 60 });
  }

  const runtime = runtimeCapabilitySeeds(environment, components ?? [], rows);
  nodes.push(...runtime.nodes);
  edges.push(...runtime.edges);

  return {
    nodes,
    edges,
    summary: {
      storageConnections: rows.filter((row) => row.active && row.connector_family === "storage").length,
      storageProbed,
      declaredContracts,
      contractsProbed,
      runtimeCapabilities: runtime.nodes.length,
      warnings,
    },
  };
}
