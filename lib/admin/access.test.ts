import { describe, expect, it } from "vitest";
import {
  canAccessPath,
  getRequiredModuleForPath,
  hasModuleAccess,
  hasModuleWriteAccess,
  hasSurfaceAccess,
  normalizeAdminUser,
} from "@/lib/admin/access";
import type { AdminUser } from "@/lib/admin/types";

function makeUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "user-1",
    auth_user_id: "auth-1",
    username: "editor1",
    email: "editor1@example.com",
    display_name: "Editor One",
    role: "editor",
    is_active: true,
    surface_access: ["cms"],
    module_access: ["cms.blog"],
    module_write_access: ["cms.blog"],
    created_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeAdminUser", () => {
  it("lowercases email and defaults arrays to empty", () => {
    const normalized = normalizeAdminUser({
      username: "sroy",
      email: "Sroy@Example.com",
      role: "viewer",
    });
    expect(normalized.email).toBe("sroy@example.com");
    expect(normalized.surface_access).toEqual([]);
    expect(normalized.module_access).toEqual([]);
  });

  it("falls back module_write_access to module_access when write access is not set", () => {
    const normalized = normalizeAdminUser({
      username: "editor1",
      email: "editor1@example.com",
      role: "editor",
      module_access: ["cms.blog", "cms.metrics"],
    });
    expect(normalized.module_write_access).toEqual(["cms.blog", "cms.metrics"]);
  });

  it("keeps module_write_access distinct from module_access when explicitly narrower", () => {
    const normalized = normalizeAdminUser({
      username: "viewer1",
      email: "viewer1@example.com",
      role: "viewer",
      module_access: ["cms.blog", "cms.metrics"],
      module_write_access: ["cms.blog"],
    });
    expect(normalized.module_write_access).toEqual(["cms.blog"]);
  });
});

describe("hasSurfaceAccess", () => {
  it("denies access for null/inactive users", () => {
    expect(hasSurfaceAccess(null, "cms")).toBe(false);
    expect(hasSurfaceAccess(makeUser({ is_active: false }), "cms")).toBe(false);
  });

  it("grants master role every surface regardless of surface_access", () => {
    const master = makeUser({ role: "master", surface_access: [] });
    expect(hasSurfaceAccess(master, "cms")).toBe(true);
    expect(hasSurfaceAccess(master, "content")).toBe(true);
  });

  it("only grants the surfaces explicitly listed for non-master users", () => {
    const user = makeUser({ surface_access: ["cms"] });
    expect(hasSurfaceAccess(user, "cms")).toBe(true);
    expect(hasSurfaceAccess(user, "content")).toBe(false);
  });
});

describe("hasModuleAccess / hasModuleWriteAccess", () => {
  it("denies module access when the surface itself is not granted", () => {
    const user = makeUser({ surface_access: [], module_access: ["cms.blog"] });
    expect(hasModuleAccess(user, "cms.blog")).toBe(false);
  });

  it("grants access via an exact module match", () => {
    const user = makeUser({ module_access: ["cms.blog"] });
    expect(hasModuleAccess(user, "cms.blog")).toBe(true);
    expect(hasModuleAccess(user, "cms.metrics")).toBe(false);
  });

  it("grants access via a surface wildcard", () => {
    const user = makeUser({ module_access: ["cms.*"] });
    expect(hasModuleAccess(user, "cms.blog")).toBe(true);
    expect(hasModuleAccess(user, "cms.metrics")).toBe(true);
    expect(hasModuleAccess(user, "content.overview")).toBe(false);
  });

  it("grants access via the global wildcard", () => {
    const user = makeUser({ surface_access: ["cms", "content"], module_access: ["*"] });
    expect(hasModuleAccess(user, "content.ads")).toBe(true);
  });

  it("keeps write access independent from read access", () => {
    const user = makeUser({ module_access: ["cms.blog"], module_write_access: [] });
    expect(hasModuleAccess(user, "cms.blog")).toBe(true);
    expect(hasModuleWriteAccess(user, "cms.blog")).toBe(false);
  });

  it("treats master as having every module's read and write access", () => {
    const master = makeUser({ role: "master", surface_access: [], module_access: [], module_write_access: [] });
    expect(hasModuleAccess(master, "content.ads")).toBe(true);
    expect(hasModuleWriteAccess(master, "content.ads")).toBe(true);
  });
});

describe("getRequiredModuleForPath / canAccessPath", () => {
  it("maps known admin paths to their module", () => {
    expect(getRequiredModuleForPath("/admin/blog")).toBe("cms.blog");
    expect(getRequiredModuleForPath("/admin/content/ads")).toBe("content.ads");
  });

  it("falls back to the content overview module for the bare content root only", () => {
    expect(getRequiredModuleForPath("/admin/content")).toBe("content.overview");
    expect(getRequiredModuleForPath("/admin/content/ads")).not.toBe("content.overview");
  });

  it("returns null for unmapped paths", () => {
    expect(getRequiredModuleForPath("/admin/unmapped-page")).toBeNull();
  });

  it("allows the gateway root for a user with any surface access", () => {
    const user = makeUser({ surface_access: ["content"], module_access: [] });
    expect(canAccessPath(user, "/admin")).toBe(true);
  });

  it("blocks the gateway root for a user with no surface access", () => {
    const user = makeUser({ surface_access: [], module_access: [] });
    expect(canAccessPath(user, "/admin")).toBe(false);
  });

  it("blocks a module path the user's role does not include", () => {
    const user = makeUser({ surface_access: ["cms"], module_access: ["cms.metrics"] });
    expect(canAccessPath(user, "/admin/blog")).toBe(false);
    expect(canAccessPath(user, "/admin/metrics")).toBe(true);
  });

  it("denies every path for an inactive user even if role/module would otherwise allow it", () => {
    const user = makeUser({ is_active: false, role: "master" });
    expect(canAccessPath(user, "/admin/blog")).toBe(false);
  });
});
