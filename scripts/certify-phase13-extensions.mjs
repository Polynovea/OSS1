import { createPgClient, createDisposableWorkspace, createAuthenticatedActor, teardownCertification } from "./cert-harness.mjs";
import { createEnvironmentFixture } from "./phase12_75-cert-utils.mjs";
import { installExtension, registerExtensionManifest } from "../lib/developer/extensionGovernanceService.ts";
import { authorizeExtensionRoute, emitExtensionEvent, extensionFetch, resolveExtensionConnection } from "../lib/developer/extensionHostService.ts";

const assert = (value, message) => { if (!value) throw new Error(message); };
const pass = (message) => console.log(`[PASS] ${message}`);
const denied = async (operation, message) => {
  let blocked = false;
  try { await operation(); } catch (error) { blocked = Number(error?.status) >= 400; }
  assert(blocked, message);
};
const manifestInput = {
  schemaVersion: 1,
  extensionKey: "cert.host",
  name: "Certification Host Extension",
  version: "1.0.0",
  compatibleCoreVersions: [">=1.0.0"],
  permissions: ["content.read"],
  routes: [{ method: "GET", path: "/extensions/cert.host/panel", permission: "content.read" }],
  events: { subscribe: [], emit: ["extension.cert.host.completed"] },
  fields: [], adminExtensions: [], requiredCapabilities: [],
  networkRequirements: [{ origin: "https://api.example.com", methods: ["GET"] }],
  requestedConnections: [{ connectorFamily: "database", connectorTypes: ["database.postgres"], scopes: ["connection.read"] }],
};

const client = await createPgClient();
let workspaceId = null;
let otherWorkspaceId = null;
const authUserIds = [], adminUserIds = [];
const originalFetch = globalThis.fetch;
try {
  const workspace = await createDisposableWorkspace(client, "p13-extension"); workspaceId = workspace.id;
  const actor = await createAuthenticatedActor(client, workspaceId, { role: "admin", permissions: [], emailPrefix: "p13-extension" });
  authUserIds.push(actor.authUserId); adminUserIds.push(actor.adminUserId);
  const context = { client, workspaceId, actor };
  const environment = await createEnvironmentFixture(context, { key: "development", kind: "development" });
  const manifest = await registerExtensionManifest({ workspaceId, actorId: actor.adminUserId, input: manifestInput });
  let installation = await installExtension({ workspaceId, actorId: actor.adminUserId, manifestId: manifest.id, grantedPermissions: ["content.read"], grantedNetwork: ["https://api.example.com"], grantedConnections: [{ connectorFamily: "database", connectorType: "database.postgres", scopes: ["connection.read"] }] });
  const common = { workspaceId, installationId: installation.id };

  const allowedRoute = await authorizeExtensionRoute({ ...common, method: "GET", path: "/extensions/cert.host/panel" });
  assert(allowedRoute.extensionKey === "cert.host", "Declared extension route should be allowed");
  await denied(() => authorizeExtensionRoute({ ...common, method: "GET", path: "/extensions/cert.host/undeclared" }), "Undeclared extension route must be denied");
  await denied(() => authorizeExtensionRoute({ ...common, method: "GET", path: "/api/v1" }), "Route outside extension namespace must be denied");
  await denied(() => authorizeExtensionRoute({ ...common, method: "GET", path: "/extensions/cert.host/%2e%2e/admin" }), "Encoded traversal must be denied");
  pass("Declared routes are namespace-, declaration-, and method-constrained.");

  globalThis.fetch = async (input, init) => String(input).startsWith("https://api.example.com")
    ? new Response("brokered", { status: 200, headers: { "content-type": "text/plain" } })
    : originalFetch(input, init);
  const network = await extensionFetch({ ...common, actorId: actor.adminUserId, url: "https://api.example.com/v1/records", method: "GET" });
  assert(network.status === 200 && network.body === "brokered", "Exact declared HTTPS network request should be brokered");
  await denied(() => extensionFetch({ ...common, actorId: actor.adminUserId, url: "https://other.example.com", method: "GET" }), "Undeclared origin must be denied");
  await denied(() => extensionFetch({ ...common, actorId: actor.adminUserId, url: "https://api.example.com", method: "POST" }), "Wrong network method must be denied");
  await denied(() => extensionFetch({ ...common, actorId: actor.adminUserId, url: "https://user:pass@api.example.com", method: "GET" }), "Credential URL must be denied");
  await denied(() => extensionFetch({ ...common, actorId: actor.adminUserId, url: "http://169.254.169.254/latest/meta-data", method: "GET" }), "Metadata endpoint must be denied");
  await denied(() => extensionFetch({ ...common, actorId: actor.adminUserId, url: "https://[::1]/", method: "GET" }), "IPv6 loopback must be denied");
  globalThis.fetch = async (input, init) => String(input).startsWith("https://api.example.com")
    ? new Response(null, { status: 302, headers: { location: "https://evil.example.com" } })
    : originalFetch(input, init);
  await denied(() => extensionFetch({ ...common, actorId: actor.adminUserId, url: "https://api.example.com/redirect", method: "GET" }), "Redirect response must be denied");
  globalThis.fetch = originalFetch;
  pass("Network broker enforces exact grant, HTTPS, SSRF, credential, method, and redirect controls.");

  const handle = await resolveExtensionConnection({ ...common, connectionId: environment.connectionId, connectorFamily: "database", connectorType: "database.postgres", scope: "connection.read" });
  assert(handle.id === environment.connectionId && !JSON.stringify(handle).match(/secret|password|database_url/i), "Typed handle must be secret-free");
  await denied(() => resolveExtensionConnection({ ...common, connectionId: environment.connectionId, connectorFamily: "analytics", connectorType: "analytics.ga4", scope: "connection.read" }), "Wrong typed connection family must be denied");
  await denied(() => resolveExtensionConnection({ ...common, connectionId: environment.connectionId, connectorFamily: "database", connectorType: "database.postgres", scope: "connection.write" }), "Ungrantable connection scope must be denied");
  pass("Typed connection handles are active, scoped, workspace-filtered, and secret-free.");

  const event = await emitExtensionEvent({ ...common, actorId: actor.adminUserId, eventType: "extension.cert.host.completed", payload: { recordId: "safe" } });
  assert(event.accepted, "Declared namespaced event should be accepted");
  await denied(() => emitExtensionEvent({ ...common, actorId: actor.adminUserId, eventType: "content.entry.published", payload: {} }), "Core-event forgery must be denied");
  await denied(() => emitExtensionEvent({ ...common, actorId: actor.adminUserId, eventType: "extension.cert.host.undeclared", payload: {} }), "Undeclared event must be denied");
  pass("Extension events are exactly declared and namespaced.");

  await client.query("update extension_installations set granted_permissions='{}'::text[] where id=$1", [installation.id]);
  await denied(() => authorizeExtensionRoute({ ...common, method: "GET", path: "/extensions/cert.host/panel" }), "Revoked permission must take effect immediately");
  await client.query("update extension_installations set status='disabled', granted_permissions=array['content.read']::text[] where id=$1", [installation.id]);
  await denied(() => emitExtensionEvent({ ...common, actorId: actor.adminUserId, eventType: "extension.cert.host.completed", payload: {} }), "Disabled installation must take effect immediately");
  pass("Grant revocation and disablement are revalidated on every host operation.");

  const other = await createDisposableWorkspace(client, "p13-extension-other"); otherWorkspaceId = other.id;
  await denied(() => authorizeExtensionRoute({ workspaceId: otherWorkspaceId, installationId: installation.id, method: "GET", path: "/extensions/cert.host/panel" }), "Cross-workspace extension access must be denied");
  pass("Cross-workspace extension access is denied.");
  console.log("=== PHASE 13 EXTENSION HOST CERTIFICATION: PASS ===");
} catch (error) {
  console.error("=== PHASE 13 EXTENSION HOST CERTIFICATION: FAIL ===");
  console.error(error?.stack || error); process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  if (otherWorkspaceId) await client.query("delete from workspaces where id=$1", [otherWorkspaceId]).catch(() => undefined);
  if (workspaceId) await teardownCertification({ client, workspaceId, authUserIds, adminUserIds }).catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
  await client.end().catch(() => undefined);
}
