import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/schema/modelService", () => ({ getVersion: vi.fn() }));

import { getVersion, type ContentModelRow } from "@/lib/schema/modelService";
import { canActorOperateModel } from "@/lib/schema/modelAccess";

const mockGetVersion = vi.mocked(getVersion);
const model: ContentModelRow = {
  id: "model-1", workspace_id: "workspace-1", name: "Customer", api_key: "customer", description: null, icon: null,
  status: "active", current_schema_version: 1, settings_json: { capability: "data_only" }, created_by: null,
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};
const actor = { adminUserId: "admin-1", workspaceId: "workspace-1", workspaceMemberId: "member-1", roleKeys: ["editor"], permissions: new Set<string>(), isMasterBypass: false };

beforeEach(() => mockGetVersion.mockReset());

describe("canActorOperateModel", () => {
  it("preserves workspace-default access when no model policy exists", async () => {
    mockGetVersion.mockResolvedValue({ schema_json: { name: "Customer", apiKey: "customer", fields: [] } } as never);
    await expect(canActorOperateModel(actor, model, "edit")).resolves.toEqual({ allowed: true });
  });

  it("permits a role and operation explicitly present in the canonical policy", async () => {
    mockGetVersion.mockResolvedValue({ schema_json: { name: "Customer", apiKey: "customer", fields: [], permissions: [{ role: "editor", operations: ["read", "edit"] }] } } as never);
    await expect(canActorOperateModel(actor, model, "edit")).resolves.toEqual({ allowed: true });
  });

  it("denies a model operation not granted to the actor's role", async () => {
    mockGetVersion.mockResolvedValue({ schema_json: { name: "Customer", apiKey: "customer", fields: [], permissions: [{ role: "editor", operations: ["read"] }] } } as never);
    await expect(canActorOperateModel(actor, model, "edit")).resolves.toMatchObject({ allowed: false, status: 403 });
  });

  it("keeps the documented master bypass for recovery and administration", async () => {
    await expect(canActorOperateModel({ ...actor, isMasterBypass: true }, model, "delete")).resolves.toEqual({ allowed: true });
    expect(mockGetVersion).not.toHaveBeenCalled();
  });
});
