import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/serviceRole", () => ({
  createServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/platform/audit", () => ({
  logPlatformEvent: vi.fn(),
}));
vi.mock("@/lib/content/searchService", () => ({
  indexEntry: vi.fn(),
}));

import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { saveDraft, createEntry, importEntries, archiveEntry, unarchiveEntry } from "@/lib/content/entryService";
import type { CanonicalSchema } from "@/lib/schema/fields/types";

const mockCreateServiceRoleClient = vi.mocked(createServiceRoleClient);

/** Same minimal Supabase-chain stand-in used by lib/schema/modelService.test.ts. */
function fakeChain(response: unknown) {
  const chain: Record<string, unknown> = { then: (resolve: (value: unknown) => void) => resolve(response) };
  for (const method of ["select", "eq", "neq", "in", "order", "insert", "delete", "update", "maybeSingle", "single"]) {
    chain[method] = vi.fn(() => chain);
  }
  return chain;
}

interface QueuedCall { table: string; response: unknown }

function queuedDb(calls: QueuedCall[]) {
  let index = 0;
  const from = vi.fn((table: string) => {
    const next = calls[index];
    if (!next) throw new Error(`Unexpected extra from("${table}") call at index ${index}`);
    if (next.table !== table) throw new Error(`Expected from("${next.table}") at call ${index}, got from("${table}")`);
    index += 1;
    return fakeChain(next.response);
  });
  return { from };
}

const schema: CanonicalSchema = {
  name: "Widget",
  apiKey: "widget",
  capability: "content_enabled",
  fields: [
    { key: "title", label: "Title", type: "text", required: true, localized: false, unique: false },
    { key: "email", label: "Email", type: "email", required: false, localized: false, unique: true },
    { key: "related", label: "Related", type: "relation", required: false, localized: false, unique: false, relation: { targetModelApiKey: "widget", cardinality: "many_to_one", onDelete: "block" } },
  ],
};

const model = { id: "model-1", workspace_id: "ws-1", name: "Widget", api_key: "widget", description: null, icon: null, status: "active" as const, current_schema_version: 1, settings_json: {}, created_by: "admin-1", created_at: "t", updated_at: "t" };
const version = { id: "version-1", content_model_id: "model-1", version_number: 1, schema_json: schema, schema_hash: "h", change_summary: null, created_by: "admin-1", created_at: "t" };
const entry = { id: "entry-1", workspace_id: "ws-1", content_model_id: "model-1", status: "draft" as const, current_draft_version_id: "ev-1", published_version_id: null, created_by: "admin-1", updated_by: "admin-1", created_at: "t", updated_at: "t", archived_at: null };
const archivedEntry = { ...entry, status: "archived" as const };
const existingVersions = [{ id: "ev-1", entry_id: "entry-1", model_schema_version: 1, version_number: 2, data_jsonb: { title: "Old" }, locale: "en", state: "draft" as const, created_by: "admin-1", created_at: "t", change_summary: null }];

beforeEach(() => {
  mockCreateServiceRoleClient.mockReset();
});

describe("saveDraft", () => {
  it("rejects edits to an archived entry", async () => {
    const db = queuedDb([{ table: "content_entries", response: { data: archivedEntry, error: null } }]);
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await saveDraft({ workspaceId: "ws-1", entryId: "entry-1", data: { title: "New" }, actorAdminUserId: "admin-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.status).toBe(409); expect(result.error).toMatch(/archived/i); }
  });

  it("rejects a stale save when expectedVersionNumber does not match the latest version", async () => {
    const db = queuedDb([
      { table: "content_entries", response: { data: entry, error: null } }, // getEntry
      { table: "content_models", response: { data: model, error: null } }, // getModel
      { table: "content_model_versions", response: { data: version, error: null } }, // getVersion (schema)
      { table: "content_entry_versions", response: { data: existingVersions, error: null } }, // listEntryVersions
    ]);
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await saveDraft({ workspaceId: "ws-1", entryId: "entry-1", data: { title: "New" }, actorAdminUserId: "admin-1", expectedVersionNumber: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect("conflict" in result).toBe(true);
    }
  });

  it("rejects invalid entry data before writing", async () => {
    const db = queuedDb([
      { table: "content_entries", response: { data: entry, error: null } },
      { table: "content_models", response: { data: model, error: null } },
      { table: "content_model_versions", response: { data: version, error: null } },
      { table: "content_entry_versions", response: { data: existingVersions, error: null } },
    ]);
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await saveDraft({ workspaceId: "ws-1", entryId: "entry-1", data: { title: "" }, actorAdminUserId: "admin-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(db.from).toHaveBeenCalledTimes(4); // no version insert attempted
  });

  it("rejects a relation field that references the entry itself", async () => {
    const db = queuedDb([
      { table: "content_entries", response: { data: entry, error: null } },
      { table: "content_models", response: { data: model, error: null } },
      { table: "content_model_versions", response: { data: version, error: null } },
      { table: "content_entry_versions", response: { data: existingVersions, error: null } },
    ]);
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await saveDraft({ workspaceId: "ws-1", entryId: "entry-1", data: { title: "New", related: "entry-1" }, actorAdminUserId: "admin-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.status).toBe(400); expect(result.error).toMatch(/itself/i); }
  });

  it("rejects a value that duplicates another entry's unique field", async () => {
    const conflictingEntry = { id: "other-entry", current_draft_version_id: "other-version", published_version_id: null };
    const db = queuedDb([
      { table: "content_entries", response: { data: entry, error: null } },
      { table: "content_models", response: { data: model, error: null } },
      { table: "content_model_versions", response: { data: version, error: null } },
      { table: "content_entry_versions", response: { data: existingVersions, error: null } },
      { table: "content_entries", response: { data: [conflictingEntry], error: null } }, // verifyUniqueValues resolves current version ids
      { table: "content_entry_versions", response: { data: [{ entry_id: "other-entry", data_jsonb: { email: "dup@example.com" } }], error: null } },
    ]);
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await saveDraft({ workspaceId: "ws-1", entryId: "entry-1", data: { title: "New", email: "dup@example.com" }, actorAdminUserId: "admin-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.status).toBe(409); expect(result.error).toMatch(/unique/i); }
  });
});

describe("createEntry", () => {
  it("rejects creation against a model that is not active", async () => {
    const db = queuedDb([{ table: "content_models", response: { data: { ...model, status: "draft" }, error: null } }]);
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await createEntry({ workspaceId: "ws-1", modelId: "model-1", data: { title: "New" }, actorAdminUserId: "admin-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it("rejects a relation targeting an entry outside the workspace", async () => {
    const db = queuedDb([
      { table: "content_models", response: { data: model, error: null } }, // getModel
      { table: "content_model_versions", response: { data: version, error: null } }, // getVersion
      { table: "content_entries", response: { data: [], error: null } }, // verifyUniqueValues (no unique value set)
      { table: "content_entries", response: { data: [], error: null } }, // verifyRelations target lookup occurs before insert — wrong-workspace target comes back empty
    ]);
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await createEntry({ workspaceId: "ws-1", modelId: "model-1", data: { title: "New", related: "entry-from-other-workspace" }, actorAdminUserId: "admin-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.status).toBe(400); expect(result.error).toMatch(/do not exist in this workspace/i); }
    expect(db.from).toHaveBeenCalledTimes(3); // no orphan entry insert after rejected relation
  });
});

describe("importEntries", () => {
  it("flags a duplicate unique value within the same import batch without writing either row", async () => {
    const db = queuedDb([
      { table: "content_models", response: { data: model, error: null } }, // getModel
      { table: "content_model_versions", response: { data: version, error: null } }, // getVersion
      { table: "content_entries", response: { data: [], error: null } }, // verifyUniqueValues for row 0 (row 1 fails on the in-batch check first, no DB call)
    ]);
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await importEntries({
      workspaceId: "ws-1",
      modelId: "model-1",
      dryRun: true,
      actorAdminUserId: "admin-1",
      rows: [{ title: "A", email: "dup@example.com" }, { title: "B", email: "dup@example.com" }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.succeeded).toBe(1);
      expect(result.data.failed).toBe(1);
      expect(result.data.results[1].errors.join(" ")).toMatch(/duplicates another row/i);
    }
  });

  it("rejects invalid rows and reports their index without writing", async () => {
    const db = queuedDb([
      { table: "content_models", response: { data: model, error: null } },
      { table: "content_model_versions", response: { data: version, error: null } },
    ]);
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await importEntries({ workspaceId: "ws-1", modelId: "model-1", dryRun: true, actorAdminUserId: "admin-1", rows: [{ title: "" }] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results[0]).toMatchObject({ index: 0, ok: false });
      expect(result.data.results[0].entryId).toBeUndefined();
    }
  });
});

describe("archiveEntry / unarchiveEntry", () => {
  it("calls cms_archive_content_entry with correct params and returns archived entry", async () => {
    const inReview = { ...entry, status: "in_review" as const };
    const rpc = vi.fn().mockResolvedValue({
      data: { ...inReview, status: "archived", status_before_archive: "in_review" },
      error: null,
    });
    const db = {
      from: vi.fn().mockReturnValue(fakeChain({ data: inReview, error: null })),
      rpc,
    };
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await archiveEntry({ workspaceId: "ws-1", entryId: "entry-1", actorAdminUserId: "admin-1" });
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("cms_archive_content_entry", {
      p_workspace_id: "ws-1",
      p_actor_id: "admin-1",
      p_entry_id: "entry-1",
    });
    if (result.ok) {
      expect(result.data.status).toBe("archived");
    }
  });

  it("calls cms_unarchive_content_entry and restores pre-archive status", async () => {
    const archivedFromApproved = { ...entry, status: "archived" as const, status_before_archive: "approved" as const };
    const rpc = vi.fn().mockResolvedValue({
      data: { ...archivedFromApproved, status: "approved", status_before_archive: null },
      error: null,
    });
    const db = {
      from: vi.fn().mockReturnValue(fakeChain({ data: archivedFromApproved, error: null })),
      rpc,
    };
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await unarchiveEntry({ workspaceId: "ws-1", entryId: "entry-1", actorAdminUserId: "admin-1" });
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("cms_unarchive_content_entry", {
      p_workspace_id: "ws-1",
      p_actor_id: "admin-1",
      p_entry_id: "entry-1",
    });
    if (result.ok) {
      expect(result.data.status).toBe("approved");
    }
  });

  it("returns error if archive or unarchive RPC fails", async () => {
    const inReview = { ...entry, status: "in_review" as const };
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Database transaction failed" },
    });
    const db = {
      from: vi.fn().mockReturnValue(fakeChain({ data: inReview, error: null })),
      rpc,
    };
    mockCreateServiceRoleClient.mockReturnValue(db as never);

    const result = await archiveEntry({ workspaceId: "ws-1", entryId: "entry-1", actorAdminUserId: "admin-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Database transaction failed");
    }
  });
});
