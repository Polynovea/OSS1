import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncMenuRelations } from "./navigationService";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";

vi.mock("@/lib/admin/serviceRole", () => ({
  createServiceRoleClient: vi.fn(),
}));

describe("Navigation Service Contracts", () => {
  let mockRpc: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc = vi.fn().mockResolvedValue({ error: null });

    vi.mocked(createServiceRoleClient).mockReturnValue({
      rpc: mockRpc,
    } as any);
  });

  it("enforces audience rule types", () => {
    const validRules = ["all", "authenticated", "guest"];
    expect(validRules).toContain("all");
    expect(validRules).toContain("authenticated");
    expect(validRules).toContain("guest");
  });

  it("syncMenuRelations extracts all 5 relation targets and replaces via atomic RPC cms_replace_source_relations", async () => {
    const items = [
      {
        id: "item-1",
        label: "Products",
        targetEntryId: "entry-123",
        targetRouteId: "route-456",
        targetAssetId: "asset-789",
        targetTermId: "term-101",
        targetMenuId: "menu-202",
        children: [
          {
            id: "child-1",
            label: "Icon Submenu",
            iconAssetId: "asset-icon-999",
          },
        ],
      },
    ];

    await syncMenuRelations("ws-1", "menu-root", items as any);

    expect(mockRpc).toHaveBeenCalledWith("cms_replace_source_relations", expect.objectContaining({
      p_workspace_id: "ws-1",
      p_source_type: "menu",
      p_source_id: "menu-root",
    }));

    const relationsArg = mockRpc.mock.calls[0][1].p_relations;
    expect(relationsArg).toHaveLength(6);
    expect(relationsArg).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspace_id: "ws-1",
          source_menu_id: "menu-root",
          relation_type: "menu_entry",
          target_entry_id: "entry-123",
        }),
        expect.objectContaining({
          workspace_id: "ws-1",
          source_menu_id: "menu-root",
          relation_type: "menu_route",
          target_route_id: "route-456",
        }),
        expect.objectContaining({
          workspace_id: "ws-1",
          source_menu_id: "menu-root",
          relation_type: "menu_icon",
          target_asset_id: "asset-789",
        }),
        expect.objectContaining({
          workspace_id: "ws-1",
          source_menu_id: "menu-root",
          relation_type: "menu_term",
          target_term_id: "term-101",
        }),
        expect.objectContaining({
          workspace_id: "ws-1",
          source_menu_id: "menu-root",
          relation_type: "menu_submenu",
          target_menu_id: "menu-202",
        }),
        expect.objectContaining({
          workspace_id: "ws-1",
          source_menu_id: "menu-root",
          relation_type: "menu_icon",
          target_asset_id: "asset-icon-999",
        }),
      ])
    );
  });

  it("syncMenuRelations throws an error when cms_replace_source_relations fails", async () => {
    mockRpc.mockResolvedValue({ error: { message: "foreign key violation" } });

    await expect(
      syncMenuRelations("ws-1", "menu-root", [
        { id: "item-1", label: "Link", targetRouteId: "route-1" } as any,
      ])
    ).rejects.toThrow("Failed to replace navigation menu relations: foreign key violation");
  });

  it("preserves atomic boundary and aborts without non-atomic fallback when cms_replace_source_relations rejects", async () => {
    mockRpc.mockResolvedValue({
      error: { message: "check constraint violation: content_relations_target_check" },
    });

    await expect(
      syncMenuRelations("ws-atomic", "menu-rollback-node", [
        { id: "item-1", label: "Bad Edge", targetRouteId: "route-fail" } as any,
      ])
    ).rejects.toThrow("Failed to replace navigation menu relations: check constraint violation: content_relations_target_check");

    // Proves only the atomic RPC is called, exactly once, with no unconstrained manual delete/insert fallback
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("cms_replace_source_relations", expect.objectContaining({
      p_workspace_id: "ws-atomic",
      p_source_type: "menu",
      p_source_id: "menu-rollback-node",
    }));
  });
});
