import { describe, expect, it } from "vitest";
import { calculateDriftCandidates } from "@/lib/intelligence/reconciliationService";
import { topologicalExecutionOrder } from "@/lib/intelligence/planningService";
import type { OperationalDesiredState } from "@/lib/intelligence/operationalTypes";

const desired: OperationalDesiredState = {
  schemaVersion: 1,
  environment: { status: "ready" },
  capabilities: {
    postgres: { state: "present", required: true, provider: "database.postgres" },
    "delivery-worker": { state: "present", required: true, provider: "vercel" },
  },
  connections: {
    "connection-1": { status: "active", connectorType: "database.postgres", family: "database" },
  },
  schemas: {
    "model-1": { version: 4, hash: "schema-v4", apiKey: "page" },
  },
  runtime: { migration: "0056", appVersion: "1.0.0", workerVersion: "1.0.0" },
  websites: {},
};

describe("Phase 12.75 deterministic reconciliation", () => {
  it("returns no drift when observed state matches desired state", () => {
    const result = calculateDriftCandidates({
      desired,
      environment: { id: "env-1", kind: "staging", status: "ready" },
      worldNodes: [
        { id: "env", node_key: "environment:env-1", state: "healthy", is_stale: false, attributes_json: { declaredStatus: "ready" }, last_observed_at: "2026-09-08T00:00:00Z" },
        { id: "postgres", node_key: "component:postgres", state: "present", provider: "database.postgres", is_stale: false, attributes_json: {}, last_observed_at: "2026-09-08T00:00:00Z" },
        { id: "worker", node_key: "component:delivery-worker", state: "present", provider: "vercel", is_stale: false, attributes_json: {}, last_observed_at: "2026-09-08T00:00:00Z" },
        { id: "connection", node_key: "connection:connection-1", state: "present", provider: "database.postgres", is_stale: false, attributes_json: { status: "active" }, last_observed_at: "2026-09-08T00:00:00Z" },
        { id: "schema", node_key: "schema:model-1", state: "present", is_stale: false, attributes_json: { deployedVersion: 4, deployedHash: "schema-v4" }, last_observed_at: "2026-09-08T00:00:00Z" },
        { id: "runtime", node_key: "runtime:cms", state: "present", is_stale: false, attributes_json: { schemaMigration: "0056", appVersion: "1.0.0", workerVersion: "1.0.0" }, last_observed_at: "2026-09-08T00:00:00Z" },
      ],
    });
    expect(result).toEqual([]);
  });

  it("never classifies production schema drift as safe auto-repair", () => {
    const result = calculateDriftCandidates({
      desired,
      environment: { id: "env-1", kind: "production", status: "ready" },
      worldNodes: [
        { id: "env", node_key: "environment:env-1", state: "healthy", is_stale: false, attributes_json: { declaredStatus: "ready" } },
        { id: "postgres", node_key: "component:postgres", state: "present", provider: "database.postgres", is_stale: false, attributes_json: {} },
        { id: "worker", node_key: "component:delivery-worker", state: "present", provider: "vercel", is_stale: false, attributes_json: {} },
        { id: "connection", node_key: "connection:connection-1", state: "present", provider: "database.postgres", is_stale: false, attributes_json: { status: "active" } },
        { id: "schema", node_key: "schema:model-1", state: "outdated", is_stale: false, attributes_json: { deployedVersion: 3, deployedHash: "schema-v3" } },
        { id: "runtime", node_key: "runtime:cms", state: "present", is_stale: false, attributes_json: { schemaMigration: "0056", appVersion: "1.0.0", workerVersion: "1.0.0" } },
      ],
    });
    const schemaDrift = result.find((item) => item.driftKey === "schema.model-1.revision");
    expect(schemaDrift).toMatchObject({ severity: "blocking", actionClass: "approval_required" });
    expect(result.some((item) => item.category === "schema" && item.actionClass === "safe_auto_repair")).toBe(false);
  });

  it("turns stale observations into refresh work rather than treating them as truth", () => {
    const result = calculateDriftCandidates({
      desired,
      environment: { id: "env-1", kind: "development", status: "ready" },
      worldNodes: [
        { id: "env", node_key: "environment:env-1", state: "healthy", is_stale: false, attributes_json: { declaredStatus: "ready" } },
        { id: "postgres", node_key: "component:postgres", state: "present", provider: "database.postgres", is_stale: true, attributes_json: {}, last_observed_at: "2026-09-01T00:00:00Z", valid_until: "2026-09-01T00:15:00Z" },
        { id: "worker", node_key: "component:delivery-worker", state: "present", provider: "vercel", is_stale: false, attributes_json: {} },
        { id: "connection", node_key: "connection:connection-1", state: "present", provider: "database.postgres", is_stale: false, attributes_json: { status: "active" } },
        { id: "schema", node_key: "schema:model-1", state: "present", is_stale: false, attributes_json: { deployedVersion: 4, deployedHash: "schema-v4" } },
        { id: "runtime", node_key: "runtime:cms", state: "present", is_stale: false, attributes_json: { schemaMigration: "0056", appVersion: "1.0.0", workerVersion: "1.0.0" } },
      ],
    });
    expect(result.find((item) => item.driftKey === "capability.postgres.stale")).toMatchObject({ actionClass: "safe_auto_repair" });
  });
});

describe("Phase 12.75 deterministic execution DAG", () => {
  it("orders dependencies before dependent nodes", () => {
    const nodes = [
      { id: "c", node_key: "verify", ordinal: 2 },
      { id: "a", node_key: "discover", ordinal: 0 },
      { id: "b", node_key: "repair", ordinal: 1 },
    ];
    const ordered = topologicalExecutionOrder(nodes, [
      { from_node_id: "a", to_node_id: "b" },
      { from_node_id: "b", to_node_id: "c" },
    ]);
    expect(ordered.map((node) => node.id)).toEqual(["a", "b", "c"]);
  });

  it("rejects cyclic execution graphs instead of guessing an order", () => {
    expect(() => topologicalExecutionOrder([
      { id: "a", node_key: "a", ordinal: 0 },
      { id: "b", node_key: "b", ordinal: 1 },
    ], [
      { from_node_id: "a", to_node_id: "b" },
      { from_node_id: "b", to_node_id: "a" },
    ])).toThrow(/cycle/i);
  });

  it("rejects edges that reference missing nodes", () => {
    expect(() => topologicalExecutionOrder([{ id: "a", node_key: "a", ordinal: 0 }], [
      { from_node_id: "a", to_node_id: "missing" },
    ])).toThrow(/unknown node/i);
  });
});
