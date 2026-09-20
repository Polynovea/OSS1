import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/serverAccess", () => ({
  requireAdminRequest: vi.fn(),
}));
vi.mock("@/lib/platform/actor", () => ({
  getDefaultWorkspace: vi.fn(),
  resolveActor: vi.fn(),
}));

import { requireAdminRequest } from "@/lib/admin/serverAccess";
import { getDefaultWorkspace, resolveActor } from "@/lib/platform/actor";
import { hasPermission, requirePlatformAccess } from "@/lib/platform/permissions";
import type { CmsActor, Workspace } from "@/lib/platform/types";

const mockRequireAdminRequest = vi.mocked(requireAdminRequest);
const mockGetDefaultWorkspace = vi.mocked(getDefaultWorkspace);
const mockResolveActor = vi.mocked(resolveActor);

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

const adminProfile = {
  id: "admin-1",
  auth_user_id: "auth-1",
  username: "editor",
  email: "editor@example.com",
  display_name: "Editor",
  role: "editor" as const,
  is_active: true,
  surface_access: ["cms"],
  module_access: ["cms.blog"],
  module_write_access: ["cms.blog"],
  created_by: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function actorWith(permissions: string[]): CmsActor {
  return {
    adminUserId: "admin-1",
    workspaceId: "ws-1",
    workspaceMemberId: "wm-1",
    roleKeys: ["editor"],
    permissions: new Set(permissions),
    isMasterBypass: false,
  };
}

function reqFor(): Request {
  return new Request("https://example.com/api/models", { headers: { authorization: "Bearer tok" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDefaultWorkspace.mockResolvedValue(workspace);
});

describe("hasPermission", () => {
  it("returns false for a null actor", () => {
    expect(hasPermission(null, "schema.read")).toBe(false);
  });

  it("checks membership in the actor's resolved permission set", () => {
    const actor = actorWith(["schema.read"]);
    expect(hasPermission(actor, "schema.read")).toBe(true);
    expect(hasPermission(actor, "schema.manage")).toBe(false);
  });
});

describe("requirePlatformAccess", () => {
  it("short-circuits with the underlying auth layer's error when the request is unauthenticated", async () => {
    const unauthorized = Response.json({ success: false, data: null, error: "Missing Authorization token" }, { status: 401 });
    mockRequireAdminRequest.mockResolvedValue({ error: unauthorized });

    const result = await requirePlatformAccess(reqFor(), { permission: "schema.read" });
    expect(result.error?.status).toBe(401);
    expect(mockResolveActor).not.toHaveBeenCalled();
  });

  it("denies access when the admin user has no workspace membership", async () => {
    mockRequireAdminRequest.mockResolvedValue({ data: { user: {} as never, profile: adminProfile } });
    mockResolveActor.mockResolvedValue(null);

    const result = await requirePlatformAccess(reqFor(), { permission: "schema.read" });
    expect(result.error?.status).toBe(403);
  });

  it("denies access when the actor lacks the required permission", async () => {
    mockRequireAdminRequest.mockResolvedValue({ data: { user: {} as never, profile: adminProfile } });
    mockResolveActor.mockResolvedValue(actorWith(["content.entry.read"]));

    const result = await requirePlatformAccess(reqFor(), { permission: "schema.manage" });
    expect(result.error?.status).toBe(403);
  });

  it("grants access when the actor has at least one of several accepted permissions", async () => {
    mockRequireAdminRequest.mockResolvedValue({ data: { user: {} as never, profile: adminProfile } });
    mockResolveActor.mockResolvedValue(actorWith(["schema.read"]));

    const result = await requirePlatformAccess(reqFor(), { permission: ["schema.manage", "schema.read"] });
    expect(result.error).toBeUndefined();
    expect(result.data?.actor.permissions.has("schema.read")).toBe(true);
    expect(result.data?.adminUser).toEqual(adminProfile);
  });
});
