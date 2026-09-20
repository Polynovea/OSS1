import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";
import { isCoreVersionCompatible, parseExtensionManifest, requestedExtensionPrivileges, type ExtensionManifest } from "@/lib/developer/extensionManifest";

export const CMS_CORE_VERSION = "1.0.0";

export async function registerExtensionManifest(params: { workspaceId: string; actorId: string; input: unknown; coreVersion?: string }) {
  const { manifest, sha256 } = parseExtensionManifest(params.input);
  const coreVersion = params.coreVersion ?? CMS_CORE_VERSION;
  if (!isCoreVersionCompatible(coreVersion, manifest.compatibleCoreVersions)) {
    throw Object.assign(new Error(`Extension ${manifest.extensionKey}@${manifest.version} is not compatible with core ${coreVersion}`), { status: 409 });
  }
  const db = createServiceRoleClient();
  const { data, error } = await db.from("extension_manifests").insert({
    workspace_id: params.workspaceId, extension_key: manifest.extensionKey, name: manifest.name, version: manifest.version,
    publisher: manifest.publisher ?? null, compatible_core_versions: manifest.compatibleCoreVersions, requested_permissions: manifest.permissions,
    routes_json: manifest.routes, events_json: manifest.events, fields_json: manifest.fields, admin_extensions_json: manifest.adminExtensions,
    network_requirements_json: manifest.networkRequirements, required_capabilities: manifest.requiredCapabilities,
    requested_connections_json: manifest.requestedConnections, manifest_json: manifest, manifest_sha256: sha256, created_by: params.actorId,
  }).select("*").single();
  if (error || !data) throw Object.assign(new Error(error?.message || "Could not register extension manifest"), { status: 400 });
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "extension.manifest.registered", entityType: "extension_manifest", entityId: data.id, metadata: { extensionKey: manifest.extensionKey, version: manifest.version, sha256 } });
  return data;
}

export async function installExtension(params: { workspaceId: string; actorId: string; manifestId: string; grantedPermissions?: string[]; grantedNetwork?: string[]; grantedConnections?: unknown[]; configuration?: Record<string, unknown>; coreVersion?: string }) {
  const db = createServiceRoleClient();
  const { data: manifest, error } = await db.from("extension_manifests").select("*").eq("workspace_id", params.workspaceId).eq("id", params.manifestId).maybeSingle();
  if (error || !manifest) throw Object.assign(new Error("Extension manifest not found in workspace"), { status: 404 });
  const parsed = parseExtensionManifest(manifest.manifest_json);
  if (!isCoreVersionCompatible(params.coreVersion ?? CMS_CORE_VERSION, parsed.manifest.compatibleCoreVersions)) throw Object.assign(new Error("Extension is incompatible with this core version"), { status: 409 });
  const requested = requestedExtensionPrivileges(parsed.manifest);
  const permissions = [...new Set(params.grantedPermissions ?? [])];
  const network = [...new Set(params.grantedNetwork ?? [])];
  if (permissions.some((item) => !requested.permissions.includes(item))) throw Object.assign(new Error("Extensions may only be granted permissions they requested"), { status: 409 });
  if (network.some((item) => !requested.networkOrigins.includes(item))) throw Object.assign(new Error("Extensions may only be granted exact network origins they requested"), { status: 409 });
  const grantedConnections = Array.isArray(params.grantedConnections) ? params.grantedConnections : [];
  for (const grant of grantedConnections as Array<any>) {
    const requestedConnection = requested.requestedConnections.find((item) => item.connectorFamily === grant?.connectorFamily);
    if (!requestedConnection || (grant?.connectorType && !requestedConnection.connectorTypes.includes(String(grant.connectorType))) || !Array.isArray(grant?.scopes) || grant.scopes.some((scope: unknown) => !requestedConnection.scopes.includes(String(scope)))) {
      throw Object.assign(new Error("Extensions may only receive typed connection scopes they requested"), { status: 409 });
    }
  }
  const { data, error: installError } = await db.from("extension_installations").upsert({
    workspace_id: params.workspaceId, manifest_id: manifest.id, status: "installed", granted_permissions: permissions,
    granted_network_json: network, granted_connections_json: grantedConnections, configuration_json: params.configuration ?? {},
    installed_by: params.actorId, installed_at: new Date().toISOString(), disabled_at: null, updated_at: new Date().toISOString(),
  }, { onConflict: "workspace_id,manifest_id" }).select("*").single();
  if (installError || !data) throw new Error(installError?.message || "Could not install extension");
  for (const permission of requested.permissions) await db.from("extension_permission_grants").upsert({ workspace_id: params.workspaceId, installation_id: data.id, permission_key: permission, decision: permissions.includes(permission) ? "granted" : "denied", granted_by: params.actorId, updated_at: new Date().toISOString() }, { onConflict: "installation_id,permission_key" });
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "extension.installed", entityType: "extension_installation", entityId: data.id, metadata: { manifestId: manifest.id, extensionKey: parsed.manifest.extensionKey, grantedPermissions: permissions, grantedNetwork: network } });
  return data;
}

export async function getActiveExtensionPrivileges(workspaceId: string, installationId: string) {
  const { data, error } = await createServiceRoleClient().from("extension_installations").select("id,workspace_id,status,granted_permissions,granted_network_json,granted_connections_json,extension_manifests!inner(extension_key,manifest_json)").eq("workspace_id", workspaceId).eq("id", installationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "installed") throw Object.assign(new Error("Extension is not active"), { status: 403 });
  return data;
}
