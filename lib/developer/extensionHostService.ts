import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";
import { getActiveExtensionPrivileges } from "@/lib/developer/extensionGovernanceService";

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const privateHost = (host: string) => {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return localHosts.has(normalized) || normalized === "0.0.0.0" || normalized === "::" || normalized === "::ffff:127.0.0.1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:") || /^10\./.test(normalized) || /^192\.168\./.test(normalized) || /^172\.(1[6-9]|2\d|3[01])\./.test(normalized) || normalized === "169.254.169.254";
};

async function active(workspaceId: string, installationId: string) {
  const installation: any = await getActiveExtensionPrivileges(workspaceId, installationId);
  const manifest = installation.extension_manifests?.manifest_json;
  if (!manifest) throw Object.assign(new Error("Extension manifest is unavailable"), { status: 409 });
  return { installation, manifest, extensionKey: String(installation.extension_manifests.extension_key) };
}

export async function authorizeExtensionRoute(params: { workspaceId: string; installationId: string; method: string; path: string }) {
  const state = await active(params.workspaceId, params.installationId);
  let decoded: string;
  try { decoded = decodeURIComponent(params.path); } catch { throw Object.assign(new Error("Extension route encoding is invalid"), { status: 400 }); }
  const expectedPrefix = `/extensions/${state.extensionKey}`;
  if (!decoded.startsWith(expectedPrefix) || (decoded.length > expectedPrefix.length && decoded[expectedPrefix.length] !== "/") || decoded.includes("..") || decoded.includes("//")) throw Object.assign(new Error("Extension route escapes its namespace"), { status: 403 });
  const route = (state.manifest.routes ?? []).find((item: any) => item.path === decoded && item.method === params.method.toUpperCase());
  if (!route) throw Object.assign(new Error("Extension route is not declared"), { status: 403 });
  if (route.permission && !state.installation.granted_permissions.includes(route.permission)) throw Object.assign(new Error("Extension route permission is not granted"), { status: 403 });
  return { extensionKey: state.extensionKey, route, grantedPermissions: state.installation.granted_permissions };
}

export async function extensionFetch(params: { workspaceId: string; installationId: string; actorId: string; url: string; method: string; body?: string }) {
  const state = await active(params.workspaceId, params.installationId);
  let target: URL; try { target = new URL(params.url); } catch { throw Object.assign(new Error("Extension URL is invalid"), { status: 400 }); }
  if (target.username || target.password || privateHost(target.hostname)) throw Object.assign(new Error("Extension URL is not permitted"), { status: 403 });
  const origin = target.origin;
  const requirement = (state.manifest.networkRequirements ?? []).find((item: any) => item.origin === origin);
  if (!requirement || !state.installation.granted_network_json.includes(origin) || !requirement.methods.includes(params.method.toUpperCase())) throw Object.assign(new Error("Extension network capability is not granted"), { status: 403 });
  if (target.protocol !== "https:" && !(target.protocol === "http:" && localHosts.has(target.hostname))) throw Object.assign(new Error("External extension network requests require HTTPS"), { status: 403 });
  const response = await fetch(target, { method: params.method, body: params.body, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) throw Object.assign(new Error("Extension redirects are blocked; declare and request the final exact origin"), { status: 409 });
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "extension.network.invoked", entityType: "extension_installation", entityId: params.installationId, metadata: { origin, method: params.method, status: response.status } });
  return { status: response.status, headers: Object.fromEntries([...response.headers].filter(([key]) => ["content-type", "content-length"].includes(key))), body: await response.text() };
}

export async function resolveExtensionConnection(params: { workspaceId: string; installationId: string; connectionId: string; connectorFamily: string; connectorType: string; scope: string }) {
  const state = await active(params.workspaceId, params.installationId);
  const grant = (state.installation.granted_connections_json ?? []).find((item: any) => item.connectorFamily === params.connectorFamily && (!item.connectorType || item.connectorType === params.connectorType) && Array.isArray(item.scopes) && item.scopes.includes(params.scope));
  if (!grant) throw Object.assign(new Error("Typed connection capability is not granted"), { status: 403 });
  const { data, error } = await createServiceRoleClient().from("workspace_connections").select("id,name,connector_family,connector_type,status,active,environment_id").eq("workspace_id", params.workspaceId).eq("id", params.connectionId).maybeSingle();
  if (error || !data || !data.active || data.status !== "active" || data.connector_family !== params.connectorFamily || data.connector_type !== params.connectorType) throw Object.assign(new Error("Workspace connection does not satisfy the granted typed capability"), { status: 403 });
  return { id: data.id, name: data.name, connectorFamily: data.connector_family, connectorType: data.connector_type, environmentId: data.environment_id, scope: params.scope };
}

export async function emitExtensionEvent(params: { workspaceId: string; installationId: string; actorId: string; eventType: string; payload: Record<string, unknown> }) {
  const state = await active(params.workspaceId, params.installationId);
  if (!params.eventType.startsWith(`extension.${state.extensionKey}.`) || !(state.manifest.events?.emit ?? []).includes(params.eventType)) throw Object.assign(new Error("Extension may emit only its declared namespaced events"), { status: 403 });
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "extension.event.emitted", entityType: "extension_installation", entityId: params.installationId, metadata: { eventType: params.eventType, payloadKeys: Object.keys(params.payload).sort() } });
  return { eventType: params.eventType, extensionKey: state.extensionKey, accepted: true };
}
