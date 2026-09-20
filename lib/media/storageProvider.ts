import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { resolveConnectionCredentials } from "@/lib/infrastructure/credentialProvider";
import { assertSafeOutboundUrl } from "@/lib/infrastructure/networkSafety";
import type { EnvironmentKind } from "@/lib/infrastructure/types";
import { deleteObject, resolveObjectUrl, uploadObject, createPresignedUpload as createLegacyR2PresignedUpload } from "@/lib/r2Storage";

export interface StorageProvider {
  readonly key: string;
  readonly kind: string;
  readonly connectionId: string | null;
  readonly environmentId: string | null;
  upload(input: { body: Buffer; key: string; contentType: string }): Promise<{ key: string; url: string }>;
  remove(key: string): Promise<void>;
  resolveReadUrl(key: string): Promise<string>;
  createPresignedUpload?(key: string, contentType: string): Promise<{ uploadUrl: string; readUrl: string }>;
}

interface StorageConnectionRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  connector_type: string;
  connector_family: string;
  name: string;
  status: string;
  active: boolean;
  config_json: Record<string, unknown>;
}

interface EnvironmentRow {
  id: string;
  storage_provider: string | null;
  is_default: boolean;
  status: string;
  kind: EnvironmentKind;
}

function configText(config: Record<string, unknown>, key: string) {
  return typeof config[key] === "string" ? String(config[key]).trim() : "";
}

function boolConfig(config: Record<string, unknown>, key: string, fallback = false) {
  const value = config[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  return fallback;
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function encodeStorageKey(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function connectionKey(id: string) {
  return `connection:${id}`;
}

function aliasesFor(type: string) {
  if (type === "storage.r2") return new Set(["r2", "cloudflare-r2", "cloudflare_r2", type]);
  if (type === "storage.s3") return new Set(["s3", "aws-s3", "aws_s3", type]);
  if (type === "storage.minio") return new Set(["minio", type]);
  if (type === "storage.supabase") return new Set(["supabase", "supabase-storage", "supabase_storage", type]);
  return new Set([type]);
}

function legacyR2Provider(): StorageProvider {
  return {
    key: "r2",
    kind: "storage.r2",
    connectionId: null,
    environmentId: null,
    async upload(input) {
      return { key: input.key, url: await uploadObject(input.body, input.key, input.contentType) };
    },
    remove: deleteObject,
    async resolveReadUrl(key) {
      return resolveObjectUrl(key);
    },
    createPresignedUpload: createLegacyR2PresignedUpload,
  };
}

async function s3Provider(connection: StorageConnectionRow, credentials: Record<string, string>, environmentKind: EnvironmentKind): Promise<StorageProvider> {
  const config = connection.config_json ?? {};
  const type = connection.connector_type;
  const bucket = configText(config, "bucket");
  if (!bucket) throw new Error(`${connection.name}: storage bucket is not configured`);

  let region = configText(config, "region") || "us-east-1";
  let endpoint = configText(config, "endpoint") || configText(config, "endpointUrl") || undefined;
  let accessKeyId = credentials.access_key_id || configText(config, "accessKeyId");
  const secretAccessKey = credentials.secret_access_key;
  let forcePathStyle = boolConfig(config, "forcePathStyle", false);

  if (type === "storage.r2") {
    const accountId = configText(config, "accountId");
    if (!accountId) throw new Error(`${connection.name}: R2 account ID is not configured`);
    endpoint = endpoint || `https://${accountId}.r2.cloudflarestorage.com`;
    region = "auto";
  }
  if (type === "storage.minio") {
    if (!endpoint) throw new Error(`${connection.name}: MinIO endpoint is not configured`);
    forcePathStyle = true;
  }
  if (!accessKeyId || !secretAccessKey) throw new Error(`${connection.name}: storage access credentials are incomplete`);
  if (endpoint) await assertSafeOutboundUrl(endpoint, environmentKind, { allowHttpLocal: true });

  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
  });
  const publicUrl = trimSlash(configText(config, "publicUrl"));

  const resolveReadUrl = async (key: string) => {
    if (publicUrl) return `${publicUrl}/${encodeStorageKey(key)}`;
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
  };

  return {
    key: connectionKey(connection.id),
    kind: type,
    connectionId: connection.id,
    environmentId: connection.environment_id,
    async upload(input) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: input.key, Body: input.body, ContentType: input.contentType }));
      return { key: input.key, url: await resolveReadUrl(input.key) };
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    resolveReadUrl,
    async createPresignedUpload(key, contentType) {
      const uploadUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn: 1800 });
      return { uploadUrl, readUrl: await resolveReadUrl(key) };
    },
  };
}

async function supabaseStorageProvider(connection: StorageConnectionRow, credentials: Record<string, string>, environmentKind: EnvironmentKind): Promise<StorageProvider> {
  const config = connection.config_json ?? {};
  const projectUrl = trimSlash(configText(config, "projectUrl"));
  const bucket = configText(config, "bucket");
  const key = credentials.service_role_key || credentials.anon_key;
  if (!projectUrl || !bucket || !key) throw new Error(`${connection.name}: Supabase Storage configuration is incomplete`);
  await assertSafeOutboundUrl(projectUrl, environmentKind, { allowHttpLocal: true });
  const client = createClient(projectUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const visibility = configText(config, "visibility") || "private";
  const configuredPublicUrl = trimSlash(configText(config, "publicUrl"));

  const resolveReadUrl = async (path: string) => {
    if (configuredPublicUrl) return `${configuredPublicUrl}/${encodeStorageKey(path)}`;
    if (visibility === "public") return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) throw new Error(error?.message || "Could not create Supabase Storage read URL");
    return data.signedUrl;
  };

  return {
    key: connectionKey(connection.id),
    kind: connection.connector_type,
    connectionId: connection.id,
    environmentId: connection.environment_id,
    async upload(input) {
      const { error } = await client.storage.from(bucket).upload(input.key, input.body, { contentType: input.contentType, upsert: false });
      if (error) throw new Error(error.message);
      return { key: input.key, url: await resolveReadUrl(input.key) };
    },
    async remove(path) {
      const { error } = await client.storage.from(bucket).remove([path]);
      if (error) throw new Error(error.message);
    },
    resolveReadUrl,
  };
}

async function providerFromConnection(workspaceId: string, connection: StorageConnectionRow): Promise<StorageProvider> {
  if (connection.workspace_id !== workspaceId || connection.connector_family !== "storage") throw new Error("Storage connection is outside the workspace boundary");
  if (!connection.active || connection.status !== "active") throw new Error(`${connection.name}: storage connection is not active; verify/reconnect it first`);
  const { data: environment, error: environmentError } = await createServiceRoleClient().from("workspace_environments").select("kind").eq("workspace_id", workspaceId).eq("id", connection.environment_id).maybeSingle();
  if (environmentError) throw new Error(environmentError.message);
  if (!environment) throw new Error("Storage connection environment is unavailable");
  const environmentKind = environment.kind as EnvironmentKind;
  const credentials = await resolveConnectionCredentials(workspaceId, connection.id);
  if (["storage.r2", "storage.s3", "storage.minio"].includes(connection.connector_type)) return s3Provider(connection, credentials, environmentKind);
  if (connection.connector_type === "storage.supabase") return supabaseStorageProvider(connection, credentials, environmentKind);
  throw new Error(`Storage connector ${connection.connector_type} has no media data-plane adapter`);
}

async function exactConnection(workspaceId: string, id: string) {
  const { data, error } = await createServiceRoleClient().from("workspace_connections").select("*")
    .eq("workspace_id", workspaceId).eq("id", id).eq("connector_family", "storage").maybeSingle();
  if (error) throw new Error(error.message);
  return data as StorageConnectionRow | null;
}

async function selectEnvironment(workspaceId: string, environmentId?: string | null): Promise<EnvironmentRow | null> {
  const db = createServiceRoleClient();
  if (environmentId) {
    const { data, error } = await db.from("workspace_environments").select("id,storage_provider,is_default,status,kind")
      .eq("workspace_id", workspaceId).eq("id", environmentId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Storage environment was not found in the workspace");
    return data as EnvironmentRow;
  }
  const { data, error } = await db.from("workspace_environments").select("id,storage_provider,is_default,status,kind")
    .eq("workspace_id", workspaceId).order("is_default", { ascending: false }).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data as EnvironmentRow | null;
}

async function selectActiveStorageConnection(workspaceId: string, environment: EnvironmentRow | null) {
  const db = createServiceRoleClient();
  let query = db.from("workspace_connections").select("*")
    .eq("workspace_id", workspaceId).eq("connector_family", "storage").eq("active", true).eq("status", "active")
    .order("last_success_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  if (environment?.id) query = query.eq("environment_id", environment.id);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as StorageConnectionRow[];
  if (!rows.length) return null;
  const preferred = environment?.storage_provider?.trim();
  if (!preferred) return rows[0];
  if (preferred.startsWith("connection:")) return rows.find((row) => row.id === preferred.slice("connection:".length)) ?? rows[0];
  return rows.find((row) => row.id === preferred || aliasesFor(row.connector_type).has(preferred.toLowerCase())) ?? rows[0];
}

export async function getStorageProvider(params: {
  workspaceId?: string;
  environmentId?: string | null;
  storageProviderKey?: string | null;
} = {}): Promise<StorageProvider> {
  const workspaceId = params.workspaceId;
  const storedKey = params.storageProviderKey?.trim() || null;

  if (storedKey?.startsWith("connection:")) {
    if (!workspaceId) throw new Error("Workspace ID is required to resolve a connection-backed asset");
    const connection = await exactConnection(workspaceId, storedKey.slice("connection:".length));
    if (!connection) throw new Error("The storage connection recorded for this asset no longer exists");
    return providerFromConnection(workspaceId, connection);
  }

  if (storedKey === "r2" && !params.environmentId) return legacyR2Provider();
  if (!workspaceId) return legacyR2Provider();

  const environment = await selectEnvironment(workspaceId, params.environmentId);
  const connection = await selectActiveStorageConnection(workspaceId, environment);
  if (connection) return providerFromConnection(workspaceId, connection);

  // Preserve Polynovea's existing deployment while OSS/environment installs move to first-class Connections.
  if (process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && (process.env.R2_ACCOUNT_ID || process.env.R2_S3_ENDPOINT)) return legacyR2Provider();

  throw new Error("No active storage connection is configured for this environment. Open Connections, add/verify storage, then retry.");
}
