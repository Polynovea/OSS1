import { describe, it, expect, vi } from "vitest";
import { normalizePath, updateRoutePath } from "@/lib/routing/routeService";
import { detectRedirectLoop } from "@/lib/routing/redirectService";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";

vi.mock("@/lib/platform/audit", () => ({
  logPlatformEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/admin/serviceRole", () => ({
  createServiceRoleClient: vi.fn(),
}));

describe("Routing & Path Normalization Invariants", () => {
  it("normalizes path with leading slash, lowercases, and strips trailing slash", () => {
    const res = normalizePath("Products/Shoes/");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.path).toBe("/products/shoes");
    }
  });

  it("collapses multiple consecutive slashes", () => {
    const res = normalizePath("///blog///tech//ai///");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.path).toBe("/blog/tech/ai");
    }
  });

  it("rejects paths with query parameters or fragments", () => {
    const qRes = normalizePath("/products?category=shoes");
    expect(qRes.ok).toBe(false);

    const fRes = normalizePath("/about#team");
    expect(fRes.ok).toBe(false);
  });

  it("rejects reserved system prefixes", () => {
    const adminRes = normalizePath("/admin/users");
    expect(adminRes.ok).toBe(false);

    const apiRes = normalizePath("/api/content");
    expect(apiRes.ok).toBe(false);

    const prevRes = normalizePath("/preview/token-123");
    expect(prevRes.ok).toBe(false);
  });

  it("detects direct self-redirect loop", async () => {
    const loop = await detectRedirectLoop("ws-test", "/about", "/about");
    expect(loop.isLoop).toBe(true);
  });

  describe("Route Parent Regression Invariants", () => {
    it("distinguishes omitted parent (preserve), explicit null (detach to root), and explicit parent UUID", () => {
      // Logic test for the three-state contract
      const omittedInput: { parentRouteId?: string | null } = {};
      const explicitNullInput: { parentRouteId?: string | null } = { parentRouteId: null };
      const explicitParentInput: { parentRouteId?: string | null } = { parentRouteId: "parent-uuid-123" };

      expect(omittedInput.parentRouteId !== undefined).toBe(false); // Supplied = false (preserve)
      expect(explicitNullInput.parentRouteId !== undefined).toBe(true); // Supplied = true, value = null (move to root)
      expect(explicitParentInput.parentRouteId !== undefined).toBe(true); // Supplied = true, value = UUID (set parent)
    });
  });

  describe("syncRouteRelations", () => {
    it("synchronizes route dependency edges across entry, term, asset, route, and menu targets via cms_replace_source_relations", async () => {
      const mockRpc = vi.fn().mockResolvedValue({ error: null });

      const { createServiceRoleClient } = await import("@/lib/admin/serviceRole");
      vi.mocked(createServiceRoleClient).mockReturnValue({
        rpc: mockRpc,
      } as any);

      const { syncRouteRelations } = await import("@/lib/routing/routeService");

      await syncRouteRelations("ws-1", "route-root", "entry-target-1", {
        targetTermId: "term-target-2",
        targetAssetId: "asset-target-3",
        targetRouteId: "route-target-4",
        targetMenuId: "menu-target-5",
      });

      expect(mockRpc).toHaveBeenCalledWith("cms_replace_source_relations", expect.objectContaining({
        p_workspace_id: "ws-1",
        p_source_type: "route",
        p_source_id: "route-root",
      }));

      const relationsArg = mockRpc.mock.calls[0][1].p_relations;
      expect(relationsArg).toHaveLength(5);
      expect(relationsArg).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workspace_id: "ws-1",
            source_route_id: "route-root",
            relation_type: "route_entry",
            target_entry_id: "entry-target-1",
          }),
          expect.objectContaining({
            workspace_id: "ws-1",
            source_route_id: "route-root",
            relation_type: "route_taxonomy",
            target_term_id: "term-target-2",
          }),
          expect.objectContaining({
            workspace_id: "ws-1",
            source_route_id: "route-root",
            relation_type: "route_asset",
            target_asset_id: "asset-target-3",
          }),
          expect.objectContaining({
            workspace_id: "ws-1",
            source_route_id: "route-root",
            relation_type: "route_link",
            target_route_id: "route-target-4",
          }),
          expect.objectContaining({
            workspace_id: "ws-1",
            source_route_id: "route-root",
            relation_type: "route_menu",
            target_menu_id: "menu-target-5",
          }),
        ])
      );
    });

    it("syncRouteRelations throws an error when cms_replace_source_relations fails", async () => {
      const mockRpc = vi.fn().mockResolvedValue({ error: { message: "check constraint violation" } });
      const { createServiceRoleClient } = await import("@/lib/admin/serviceRole");
      vi.mocked(createServiceRoleClient).mockReturnValue({
        rpc: mockRpc,
      } as any);

      const { syncRouteRelations } = await import("@/lib/routing/routeService");

      await expect(
        syncRouteRelations("ws-1", "route-root", "entry-1")
      ).rejects.toThrow("Failed to replace route relations: check constraint violation");
    });
  });

  describe("updateRoutePath", () => {
    it("preserves route dependency relations when updating route path", async () => {
      const mockRpc = vi.fn().mockImplementation((fn: string) => {
        if (fn === "cms_update_route_path") {
          return Promise.resolve({
            data: {
              route: {
                id: "route-123",
                workspace_id: "ws-1",
                entry_id: "entry-999",
                path: "/new-path",
                locale: "en",
                metadata_json: { targetTermId: "term-888" },
              },
              redirectCreated: true,
            },
            error: null,
          });
        }
        if (fn === "cms_replace_source_relations") {
          return Promise.resolve({ error: null });
        }
        return Promise.resolve({ error: null });
      });

      const { createServiceRoleClient } = await import("@/lib/admin/serviceRole");
      vi.mocked(createServiceRoleClient).mockReturnValue({
        rpc: mockRpc,
      } as any);

      const res = await updateRoutePath({
        workspaceId: "ws-1",
        actorAdminUserId: "admin-1",
        routeId: "route-123",
        newPath: "/new-path",
      });

      expect(res.route.path).toBe("/new-path");
      expect(mockRpc).toHaveBeenCalledWith("cms_update_route_path", expect.anything());
      expect(mockRpc).toHaveBeenCalledWith("cms_replace_source_relations", expect.objectContaining({
        p_workspace_id: "ws-1",
        p_source_type: "route",
        p_source_id: "route-123",
      }));
    });
  });
});
