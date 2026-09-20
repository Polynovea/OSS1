import { createPgClient, createDisposableWorkspace, createAuthenticatedActor, teardownCertification } from "./cert-harness.mjs";
import { createDeveloperApiToken } from "../lib/developer/apiTokenService.ts";
import { authorizeBoundAgentTool, bindDeveloperTokenToAgent, createAgentIdentity, recordAgentOperationProvenance } from "../lib/developer/agentGovernanceService.ts";
import { installExtension, registerExtensionManifest } from "../lib/developer/extensionGovernanceService.ts";
import { POST as agentToolPost } from "../app/api/v1/agent-tools/route.ts";
import { requireDeveloperApi } from "../lib/developer/apiAuth.ts";

const assert = (value, message) => { if (!value) throw new Error(message); };
const pass = (message) => console.log(`[PASS] ${message}`);
const client = await createPgClient();
let workspaceId = null;
const authUserIds = [], adminUserIds = [];
try {
  const ws = await createDisposableWorkspace(client, "p13-foundation"); workspaceId = ws.id;
  // Phase 13 developer scopes are token policy, not RBAC catalog keys. The
  // disposable admin actor needs no synthetic role permissions for this
  // service-level certificate.
  const actor = await createAuthenticatedActor(client, workspaceId, { role: "admin", permissions: [], emailPrefix: "p13" });
  authUserIds.push(actor.authUserId); adminUserIds.push(actor.adminUserId);
  const token = await createDeveloperApiToken({ workspaceId, actorId: actor.adminUserId, name: "Phase 13 governed agent", scopes: ["agent.read", "content.read", "content.write", "content.publish", "content.delete", "extension.read", "extension.manage", "operational_intelligence.execute"] });
  const agent = await createAgentIdentity({ workspaceId, actorId: actor.adminUserId, agentKey: "cert.agent", name: "Certification Agent", defaultMode: "draft_only" });
  await bindDeveloperTokenToAgent({ workspaceId, actorId: actor.adminUserId, tokenId: token.token.id, agentIdentityId: agent.id });
  const draft = await authorizeBoundAgentTool({ workspaceId, tokenId: token.token.id, toolName: "cms.draft.create", initiatingAdminUserId: actor.adminUserId });
  const publish = await authorizeBoundAgentTool({ workspaceId, tokenId: token.token.id, toolName: "cms.publish", initiatingAdminUserId: actor.adminUserId });
  assert(draft.allowed, "Draft write should be authorized for a draft-only agent");
  assert(!publish.allowed && publish.code === "AGENT_DRAFT_ONLY", "Draft-only agent must not publish even when the token has content.publish");
  pass("Bound agent preserves draft-first/high-risk separation.");
  const invokeControl = async (toolName) => {
    const response = await agentToolPost(new Request("http://polynovea.local/api/v1/agent-tools", { method: "POST", headers: { authorization: `Bearer ${token.secret}`, "content-type": "application/json", "x-request-id": `p13-${toolName}` }, body: JSON.stringify({ action: "authorize", toolName, safeInputSummary: { certification: true } }) }));
    return { status: response.status, body: await response.json() };
  };
  const controlledDraft = await invokeControl("cms.draft.create");
  const controlledPublish = await invokeControl("cms.publish");
  assert(controlledDraft.status === 200 && controlledDraft.body.data?.provenanceId, "MCP control plane must authorize and record a draft tool");
  assert(controlledPublish.status === 403, "MCP control plane must reject draft-only high-risk publish");
  pass("MCP control plane authenticates a bound token and records authorization provenance.");
  const directPublish = await requireDeveloperApi(new Request("http://polynovea.local/api/v1/entries/11111111-1111-1111-1111-111111111111/publish", { method: "POST", headers: { authorization: `Bearer ${token.secret}` } }), { scope: "content.publish", requireActor: true });
  assert(directPublish.error && (await directPublish.error.clone().json()).error.code === "AGENT_DRAFT_ONLY", "Direct ordinary API publish must enforce bound-agent policy");
  pass("A bound draft-only credential cannot bypass policy through the ordinary publish API.");
  const provenance = await recordAgentOperationProvenance({ workspaceId, agentIdentityId: agent.id, developerApiTokenId: token.token.id, initiatingAdminUserId: actor.adminUserId, requestId: "phase13-foundation-cert", toolName: "cms.draft.create", status: "succeeded", sourceContext: [{ type: "certification", id: "phase13" }], changedFields: ["status"], safeInputSummary: { operation: "draft-create" } });
  assert(provenance.input_digest_sha256?.match(/^[0-9a-f]{64}$/), "Provenance must retain a canonical input digest");
  assert(!JSON.stringify(provenance).includes(token.secret), "Provenance leaked the raw developer token");
  pass("Agent mutation provenance is durable and secret-free.");
  const manifest = await registerExtensionManifest({ workspaceId, actorId: actor.adminUserId, input: { schemaVersion: 1, extensionKey: "cert.extension", name: "Certification Extension", version: "1.0.0", compatibleCoreVersions: [">=1.0.0"], permissions: ["content.read"], routes: [{ method: "GET", path: "/extensions/cert.extension/panel", permission: "content.read" }], events: { subscribe: ["content.entry.published"], emit: ["extension.cert.extension.completed"] }, fields: [], adminExtensions: [], networkRequirements: [{ origin: "https://api.example.com", methods: ["GET"] }], requiredCapabilities: [], requestedConnections: [] } });
  const installation = await installExtension({ workspaceId, actorId: actor.adminUserId, manifestId: manifest.id, grantedPermissions: [], grantedNetwork: [] });
  assert(installation.status === "installed" && installation.granted_permissions.length === 0, "Requested extension permission must not be auto-granted");
  let overGrantBlocked = false;
  try { await installExtension({ workspaceId, actorId: actor.adminUserId, manifestId: manifest.id, grantedPermissions: ["content.write"] }); } catch { overGrantBlocked = true; }
  assert(overGrantBlocked, "Extension over-grant must be rejected");
  pass("Extension installation preserves requested-not-granted permission boundaries.");
  const tables = ["agent_identities", "agent_operation_provenance", "extension_manifests", "extension_installations", "extension_permission_grants"];
  const { rows } = await client.query("select relname,relrowsecurity from pg_class join pg_namespace on pg_namespace.oid=pg_class.relnamespace where nspname='public' and relname=any($1::text[])", [tables]);
  assert(rows.length === tables.length && rows.every(row => row.relrowsecurity), "All Phase 13 governance tables must exist with RLS enabled");
  pass("Phase 13 governance tables are RLS-enabled.");
  console.log("=== PHASE 13 FOUNDATION CERTIFICATION: PASS ===");
} catch (error) { console.error("=== PHASE 13 FOUNDATION CERTIFICATION: FAIL ==="); console.error(error?.stack || error); process.exitCode = 1; }
finally { if (workspaceId) await teardownCertification({ client, workspaceId, authUserIds, adminUserIds }).catch(error => { console.error(error?.stack || error); process.exitCode = 1; }); await client.end().catch(() => undefined); }
