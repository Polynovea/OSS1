import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/serviceRole", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/platform/audit", () => ({ logPlatformEvent: vi.fn() }));

import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { createSavedEntryView, deleteSavedEntryView } from "@/lib/content/savedViewService";

const service = vi.mocked(createServiceRoleClient);
function chain(response: unknown) { const value: Record<string, unknown> = { then: (resolve: (item: unknown) => void) => resolve(response) }; for (const method of ["select", "eq", "order", "insert", "delete", "maybeSingle", "single"]) value[method] = vi.fn(() => value); return value; }

beforeEach(() => service.mockReset());

describe("saved entry views", () => {
  it("normalizes a persisted view and scopes it to the actor's workspace", async () => {
    const row = { id: "view-1", name: "My customers", filters_json: { modelId: "model-1", sort: "updated_asc" } };
    const insert = chain({ data: row, error: null }); const db = { from: vi.fn(() => insert) }; service.mockReturnValue(db as never);
    const result = await createSavedEntryView({ workspaceId: "ws-1", actorAdminUserId: "admin-1", name: " My customers ", filters: { modelId: "model-1", sort: "updated_asc", unexpected: "ignored" } });
    expect(result.ok).toBe(true); expect(db.from).toHaveBeenCalledWith("content_entry_saved_views");
    expect(insert.insert as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "ws-1", created_by: "admin-1", name: "My customers", filters_json: { modelId: "model-1", sort: "updated_asc" } }));
  });

  it("cannot delete another actor's view", async () => {
    const lookup = chain({ data: null, error: null }); const db = { from: vi.fn(() => lookup) }; service.mockReturnValue(db as never);
    const result = await deleteSavedEntryView({ workspaceId: "ws-1", actorAdminUserId: "admin-1", viewId: "other-view" });
    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(db.from).toHaveBeenCalledTimes(1);
  });
});
