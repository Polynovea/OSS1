import { describe, expect, it } from "vitest";
import { evaluateAgentToolAccess, getAgentToolDefinition } from "@/lib/developer/agentToolRegistry";
import { isCoreVersionCompatible, parseExtensionManifest } from "@/lib/developer/extensionManifest";

const baseManifest = {
  schemaVersion: 1 as const,
  extensionKey: "analytics.example",
  name: "Analytics Example",
  version: "1.0.0",
  compatibleCoreVersions: [">=1.0.0"],
  permissions: ["analytics.read"],
  routes: [{ method: "GET" as const, path: "/extensions/analytics.example/report", permission: "analytics.read" }],
  events: { subscribe: ["content.entry.published"], emit: [] },
  fields: [],
  adminExtensions: [],
  networkRequirements: [{ origin: "https://api.example.com", methods: ["GET" as const] }],
  requiredCapabilities: ["analytics"],
  requestedConnections: [{ connectorFamily: "analytics", connectorTypes: ["analytics.ga4"], scopes: ["analytics.read"] }],
};

describe("Phase 13 governed agent foundation", () => {
  it("allows scoped reads without requiring a human mutation actor", () => {
    const access = evaluateAgentToolAccess({
      toolName: "cms.content.search",
      tokenScopes: ["content.read"],
      agentDefaultMode: "draft_only",
    });
    expect(access.allowed).toBe(true);
  });

  it("requires an initiating human for agent mutations", () => {
    const access = evaluateAgentToolAccess({
      toolName: "cms.draft.create",
      tokenScopes: ["content.write"],
      agentDefaultMode: "draft_only",
    });
    expect(access.allowed).toBe(false);
    expect(access.code).toBe("INITIATING_USER_REQUIRED");
  });

  it("allows a draft-only agent to create drafts but never grants publish", () => {
    const draft = evaluateAgentToolAccess({ toolName: "cms.draft.create", tokenScopes: ["content.write"], agentDefaultMode: "draft_only", initiatingAdminUserId: "11111111-1111-1111-1111-111111111111" });
    const publish = evaluateAgentToolAccess({ toolName: "cms.publish", tokenScopes: ["content.publish"], agentDefaultMode: "draft_only", initiatingAdminUserId: "11111111-1111-1111-1111-111111111111" });
    expect(draft.allowed).toBe(true);
    expect(publish.code).toBe("AGENT_DRAFT_ONLY");
  });

  it("keeps high-risk tools blocked for draft-only agents even with token scope", () => {
    const access = evaluateAgentToolAccess({
      toolName: "cms.publish",
      tokenScopes: ["content.publish"],
      agentDefaultMode: "draft_only",
      initiatingAdminUserId: "11111111-1111-1111-1111-111111111111",
    });
    expect(access.allowed).toBe(false);
    expect(access.code).toBe("AGENT_DRAFT_ONLY");
  });

  it("requires an explicit destructive-content scope for delete", () => {
    const denied = evaluateAgentToolAccess({
      toolName: "cms.delete",
      tokenScopes: ["content.write"],
      agentDefaultMode: "scoped",
      initiatingAdminUserId: "11111111-1111-1111-1111-111111111111",
    });
    const allowed = evaluateAgentToolAccess({
      toolName: "cms.delete",
      tokenScopes: ["content.delete"],
      agentDefaultMode: "scoped",
      initiatingAdminUserId: "11111111-1111-1111-1111-111111111111",
    });
    expect(denied.allowed).toBe(false);
    expect(allowed.allowed).toBe(true);
  });

  it("marks operational execution as high-risk and deterministic-controller backed", () => {
    const tool = getAgentToolDefinition("cms.operational.execute");
    expect(tool?.operationClass).toBe("high_risk");
    expect(tool?.usesDeterministicController).toBe(true);
  });

  it("requires the dedicated execution scope for operational execution", () => {
    const access = evaluateAgentToolAccess({ toolName: "cms.operational.execute", tokenScopes: ["operational_intelligence.write"], agentDefaultMode: "scoped", initiatingAdminUserId: "11111111-1111-1111-1111-111111111111" });
    expect(access.allowed).toBe(false);
    expect(access.code).toBe("INSUFFICIENT_SCOPE");
  });
});

describe("Phase 13 constrained extension manifest", () => {
  it("accepts a namespaced manifest and returns a stable canonical hash", () => {
    const a = parseExtensionManifest(baseManifest);
    const b = parseExtensionManifest({ ...baseManifest, name: "Analytics Example" });
    expect(a.manifest.extensionKey).toBe("analytics.example");
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.sha256).toBe(b.sha256);
  });

  it("rejects wildcard network access", () => {
    expect(() => parseExtensionManifest({
      ...baseManifest,
      networkRequirements: [{ origin: "https://*.example.com", methods: ["GET"] }],
    })).toThrow(/wildcards/i);
  });

  it("rejects insecure external HTTP network access", () => {
    expect(() => parseExtensionManifest({
      ...baseManifest,
      networkRequirements: [{ origin: "http://api.example.com", methods: ["GET"] }],
    })).toThrow(/HTTPS/i);
  });

  it("allows localhost HTTP for self-hosted development", () => {
    const parsed = parseExtensionManifest({
      ...baseManifest,
      networkRequirements: [{ origin: "http://localhost:8080", methods: ["GET"] }],
    });
    expect(parsed.manifest.networkRequirements[0].origin).toBe("http://localhost:8080");
  });

  it("rejects routes that escape the extension namespace", () => {
    expect(() => parseExtensionManifest({
      ...baseManifest,
      routes: [{ method: "GET", path: "/api/admin/secret", permission: "analytics.read" }],
    })).toThrow(/inside \/extensions\/analytics\.example/i);
  });

  it("rejects route permissions that were not declared by the extension", () => {
    expect(() => parseExtensionManifest({
      ...baseManifest,
      routes: [{ method: "GET", path: "/extensions/analytics.example/report", permission: "content.write" }],
    })).toThrow(/must be declared/i);
  });

  it("requires extension-emitted events to stay in the extension namespace", () => {
    expect(() => parseExtensionManifest({ ...baseManifest, events: { subscribe: [], emit: ["content.entry.forged"] } })).toThrow(/namespaced/i);
  });

  it("evaluates core compatibility deterministically", () => {
    expect(isCoreVersionCompatible("1.3.2", [">=1.0.0"])).toBe(true);
    expect(isCoreVersionCompatible("2.0.0", ["^1.2.0"])).toBe(false);
    expect(isCoreVersionCompatible("1.3.2", ["~1.2.0"])).toBe(false);
  });
});
