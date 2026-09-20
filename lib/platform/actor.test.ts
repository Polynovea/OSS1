import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/serviceRole", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { getDefaultWorkspace, resolveActor } from "@/lib/platform/actor";
import type { Workspace } from "@/lib/platform/types";

const mockCreateServiceRoleClient = vi.mocked(createServiceRoleClient);

const workspace: Workspace = {
  id: "ws-1",
  name: "Polynovea",
  slug: "polynovea",
  status: "active",
  default_locale: "en",
  timezone: "UTC",
  settings_json: {},
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

interface FakeDbConfig {
  workspaceRow?: Workspace | null;
  memberRow?: { id: string; status: string } | null;
  roleRows?: { role_id: string; roles: { key: string } }[];
  permissionRows?: { permission_key: string }[];
  /**
   * If set, the workspace_members mock only returns `memberRow` when the
   * queried workspace_id matches this value — everything else resolves
   * null, the way a real `.eq("workspace_id", ...)` filter would. This is
   * what lets the isolation tests below prove resolveActor actually scopes
   * by workspace, rather than just trusting the query builder was called
   * with the right arguments.
   */
  memberRowExistsOnlyForWorkspaceId?: string;
}

function fakeDb({
  workspaceRow = workspace,
  memberRow = null,
  roleRows = [],
  permissionRows = [],
  memberRowExistsOnlyForWorkspaceId,
}: FakeDbConfig) {
  const handlers: Record<string, unknown> = {
    workspaces: {
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: workspaceRow, error: workspaceRow ? null : { message: "not found" } }),
        }),
      }),
    },
    workspace_members: {
      select: () => ({
        eq: (_col: string, queriedWorkspaceId: string) => ({
          eq: () => ({
            maybeSingle: () => {
              const matches =
                memberRowExistsOnlyForWorkspaceId === undefined ||
                queriedWorkspaceId === memberRowExistsOnlyForWorkspaceId;
              return Promise.resolve({ data: matches ? memberRow : null, error: null });
            },
          }),
        }),
      }),
    },
    member_roles: {
      select: () => ({
        eq: () => Promise.resolve({ data: roleRows, error: null }),
      }),
    },
    role_permissions: {
      select: () => ({
        in: () => Promise.resolve({ data: permissionRows, error: null }),
      }),
    },
  };

  return { from: vi.fn((table: string) => handlers[table]) };
}

beforeEach(() => {
  mockCreateServiceRoleClient.mockReset();
});

describe("getDefaultWorkspace", () => {
  it("resolves the seeded polynovea workspace by slug", async () => {
    mockCreateServiceRoleClient.mockReturnValue(fakeDb({}) as never);
    const result = await getDefaultWorkspace();
    expect(result.slug).toBe("polynovea");
  });

  it("throws a clear error when the workspace migration hasn't been applied", async () => {
    mockCreateServiceRoleClient.mockReturnValue(fakeDb({ workspaceRow: null }) as never);
    await expect(getDefaultWorkspace()).rejects.toThrow(/0007_workspace_core/);
  });
});

describe("resolveActor", () => {
  it("returns null when the admin user has no workspace_members row", async () => {
    mockCreateServiceRoleClient.mockReturnValue(fakeDb({ memberRow: null }) as never);
    const actor = await resolveActor({ id: "admin-1", email: "editor@example.com" }, workspace);
    expect(actor).toBeNull();
  });

  it("returns null when the member's row is not active", async () => {
    mockCreateServiceRoleClient.mockReturnValue(
      fakeDb({ memberRow: { id: "wm-1", status: "suspended" } }) as never,
    );
    const actor = await resolveActor({ id: "admin-1", email: "editor@example.com" }, workspace);
    expect(actor).toBeNull();
  });

  it("resolves role keys and the union of their permissions for an active member", async () => {
    mockCreateServiceRoleClient.mockReturnValue(
      fakeDb({
        memberRow: { id: "wm-1", status: "active" },
        roleRows: [{ role_id: "role-editor", roles: { key: "editor" } }],
        permissionRows: [{ permission_key: "content.entry.read" }, { permission_key: "content.entry.create" }],
      }) as never,
    );
    const actor = await resolveActor({ id: "admin-1", email: "editor@example.com" }, workspace);
    expect(actor?.isMasterBypass).toBe(false);
    expect(actor?.workspaceMemberId).toBe("wm-1");
    expect(actor?.roleKeys).toEqual(["editor"]);
    expect(actor?.permissions.has("content.entry.read")).toBe(true);
    expect(actor?.permissions.has("schema.manage")).toBe(false);
  });

  it("returns an actor with an empty permission set when the member has no roles assigned", async () => {
    mockCreateServiceRoleClient.mockReturnValue(
      fakeDb({ memberRow: { id: "wm-2", status: "active" }, roleRows: [] }) as never,
    );
    const actor = await resolveActor({ id: "admin-2", email: "unassigned@example.com" }, workspace);
    expect(actor).not.toBeNull();
    expect(actor?.permissions.size).toBe(0);
  });

  describe("workspace isolation", () => {
    const otherWorkspace: Workspace = { ...workspace, id: "ws-2", slug: "other-workspace" };

    it("resolves an actor for a member scoped to that exact workspace", async () => {
      mockCreateServiceRoleClient.mockReturnValue(
        fakeDb({
          memberRow: { id: "wm-1", status: "active" },
          roleRows: [{ role_id: "role-editor", roles: { key: "editor" } }],
          permissionRows: [{ permission_key: "content.entry.read" }],
          memberRowExistsOnlyForWorkspaceId: workspace.id,
        }) as never,
      );
      const actor = await resolveActor({ id: "admin-1", email: "editor@example.com" }, workspace);
      expect(actor).not.toBeNull();
    });

    it("does not resolve an actor for the same admin user queried against a different workspace", async () => {
      mockCreateServiceRoleClient.mockReturnValue(
        fakeDb({
          memberRow: { id: "wm-1", status: "active" },
          roleRows: [{ role_id: "role-editor", roles: { key: "editor" } }],
          permissionRows: [{ permission_key: "content.entry.read" }],
          // This admin user's membership only exists in `workspace`, not `otherWorkspace`.
          memberRowExistsOnlyForWorkspaceId: workspace.id,
        }) as never,
      );
      const actor = await resolveActor({ id: "admin-1", email: "editor@example.com" }, otherWorkspace);
      expect(actor).toBeNull();
    });
  });
});
