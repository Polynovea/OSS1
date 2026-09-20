import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/serviceRole", () => ({
  createServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/platform/audit", () => ({
  logPlatformEvent: vi.fn(),
}));

import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";
import { applyChange, createModel, type ContentModelRow, type ContentModelVersionRow } from "@/lib/schema/modelService";

const mockCreateServiceRoleClient = vi.mocked(createServiceRoleClient);
const mockLogPlatformEvent = vi.mocked(logPlatformEvent);

/**
 * A minimal stand-in for the Supabase query builder: every chainable method
 * returns the same object, and the object itself is thenable, resolving to
 * whatever response was configured for that from(table) call — regardless
 * of how many/which chain methods were called first (.select().eq().eq()
 * .maybeSingle(), .insert(rows), .delete().eq(), etc. all just work).
 */
function fakeChain(response: unknown) {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: unknown) => void) => resolve(response),
  };
  for (const method of ["select", "eq", "order", "insert", "delete", "update", "maybeSingle", "single"]) {
    chain[method] = vi.fn(() => chain);
  }
  return chain;
}

interface QueuedCall {
  table: string;
  response: unknown;
}

function queuedDb(calls: QueuedCall[]) {
  let index = 0;
  const from = vi.fn((table: string) => {
    const next = calls[index];
    if (!next) throw new Error(`Unexpected extra from("${table}") call at index ${index}`);
    if (next.table !== table) {
      throw new Error(`Expected from("${next.table}") at call ${index}, got from("${table}")`);
    }
    index += 1;
    return fakeChain(next.response);
  });
  return { from };
}

const validSchema = {
  name: "Blog Post",
  apiKey: "blog_post",
  fields: [{ key: "title", label: "Title", type: "text", required: true }],
};

const modelRow: ContentModelRow = {
  id: "model-1",
  workspace_id: "ws-1",
  name: "Blog Post",
  api_key: "blog_post",
  description: null,
  icon: null,
  status: "active",
  current_schema_version: 1,
  settings_json: { capability: "content_enabled" },
  created_by: "admin-1",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const versionRow: ContentModelVersionRow = {
  id: "version-1",
  content_model_id: "model-1",
  version_number: 1,
  schema_json: validSchema as never,
  schema_hash: "abc",
  change_summary: "Initial version",
  created_by: "admin-1",
  created_at: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  mockCreateServiceRoleClient.mockReset();
  mockLogPlatformEvent.mockReset();
});

describe("createModel", () => {
  it("rejects a structurally invalid schema before touching the database", async () => {
    const db = { from: vi.fn(), rpc: vi.fn() };
    mockCreateServiceRoleClient.mockReturnValue(db as never);
    const result = await createModel({
      workspaceId: "ws-1",
      proposedSchema: { name: "Bad", apiKey: "Bad Key!", fields: [] },
      createdBy: "admin-1",
    });
    expect(result.ok).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("rejects creation when a model with the same apiKey already exists in the workspace", async () => {
    const db = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "23505", message: 'A content model with apiKey "blog_post" already exists in this workspace' },
      }),
    };
    mockCreateServiceRoleClient.mockReturnValue(db as never);
    const result = await createModel({ workspaceId: "ws-1", proposedSchema: validSchema, createdBy: "admin-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("creates the model, its first version, and rebuilds content_fields on success", async () => {
    const db = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({
        data: { model: modelRow, version: versionRow },
        error: null,
      }),
    };
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await createModel({ workspaceId: "ws-1", proposedSchema: validSchema, createdBy: "admin-1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.model.api_key).toBe("blog_post");
      expect(result.data.version.version_number).toBe(1);
    }
    expect(db.rpc).toHaveBeenCalledWith("cms_create_content_model", expect.objectContaining({
      p_api_key: "blog_post",
      p_workspace_id: "ws-1",
    }));
  });

  it("projects the schema's capability into settings_json on insert", async () => {
    const db = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({
        data: { model: { ...modelRow, settings_json: { capability: "data_only" } }, version: versionRow },
        error: null,
      }),
    };
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const dataOnlySchema = { ...validSchema, apiKey: "customer", capability: "data_only" as const };
    await createModel({ workspaceId: "ws-1", proposedSchema: dataOnlySchema, createdBy: "admin-1" });

    expect(db.rpc).toHaveBeenCalledWith("cms_create_content_model", expect.objectContaining({
      p_capability: "data_only",
    }));
  });

  it("rejects a data_only model that grants a publish permission", async () => {
    const db = { from: vi.fn(), rpc: vi.fn() };
    mockCreateServiceRoleClient.mockReturnValue(db as never);
    const result = await createModel({
      workspaceId: "ws-1",
      proposedSchema: { ...validSchema, capability: "data_only", permissions: [{ role: "editor", operations: ["publish"] }] },
      createdBy: "admin-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/publish/i);
  });
});

describe("applyChange", () => {
  it("does not create a duplicate immutable version when the reviewed schema is unchanged", async () => {
    const db = queuedDb([{ table: "content_model_versions", response: { data: versionRow, error: null } }]);
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await applyChange({ model: modelRow, proposedSchema: validSchema, acknowledgeUnsafe: true, actorAdminUserId: "admin-1" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toMatchObject({ applied: false, noChanges: true, blockedReason: "No schema changes to apply" });
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(mockLogPlatformEvent).not.toHaveBeenCalled();
  });

  it("blocks a destructive change and does not write a new version when acknowledgeUnsafe is not set", async () => {
    const currentVersion: ContentModelVersionRow = {
      ...versionRow,
      schema_json: { name: "Blog Post", apiKey: "blog_post", fields: [{ key: "title", label: "Title", type: "text", required: false }] } as never,
    };
    const db = queuedDb([{ table: "content_model_versions", response: { data: currentVersion, error: null } }]);
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const proposedSchema = {
      name: "Blog Post",
      apiKey: "blog_post",
      fields: [], // removing the only field -> DESTRUCTIVE
    };

    const result = await applyChange({
      model: modelRow,
      proposedSchema,
      acknowledgeUnsafe: false,
      actorAdminUserId: "admin-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.applied).toBe(false);
      expect(result.data.diff.overallClassification).toBe("DESTRUCTIVE");
    }
    // Only the one read for the current version happened — no version insert, no field rebuild.
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("applies a destructive change when acknowledgeUnsafe is true", async () => {
    const currentVersion: ContentModelVersionRow = {
      ...versionRow,
      schema_json: { name: "Blog Post", apiKey: "blog_post", fields: [{ key: "title", label: "Title", type: "text", required: false }] } as never,
    };
    const nextVersion: ContentModelVersionRow = { ...versionRow, version_number: 2 };

    const baseDb = queuedDb([
      { table: "content_model_versions", response: { data: currentVersion, error: null } },
    ]);
    const db = {
      ...baseDb,
      rpc: vi.fn().mockResolvedValue({
        data: { version: nextVersion },
        error: null,
      }),
    };
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await applyChange({
      model: modelRow,
      proposedSchema: { name: "Blog Post", apiKey: "blog_post", fields: [] },
      acknowledgeUnsafe: true,
      actorAdminUserId: "admin-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.applied).toBe(true);
      expect(result.data.version?.version_number).toBe(2);
    }
    expect(db.rpc).toHaveBeenCalledWith("cms_apply_model_schema_version", expect.objectContaining({
      p_model_id: "model-1",
    }));
  });

  it("rejects a change that alters apiKey", async () => {
    const currentVersion: ContentModelVersionRow = { ...versionRow };
    const db = queuedDb([{ table: "content_model_versions", response: { data: currentVersion, error: null } }]);
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await applyChange({
      model: modelRow,
      proposedSchema: { ...validSchema, apiKey: "renamed_key" },
      acknowledgeUnsafe: true,
      actorAdminUserId: "admin-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/apiKey/i);
  });
});
