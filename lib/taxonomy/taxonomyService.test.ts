import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listTaxonomies,
  createTaxonomy,
  getTaxonomy,
  listTerms,
  createTerm,
  mergeTerms,
  assignVersionTerms,
  getVersionTerms,
} from "@/lib/taxonomy/taxonomyService";

vi.mock("@/lib/platform/audit", () => ({
  logPlatformEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/admin/serviceRole", () => ({
  createServiceRoleClient: vi.fn(),
}));

describe("Taxonomy Service", () => {
  it("rejects merge into self", async () => {
    await expect(
      mergeTerms({
        workspaceId: "ws-1",
        actorAdminUserId: "user-1",
        sourceTermId: "term-1",
        targetTermId: "term-1",
      })
    ).rejects.toThrow("Cannot merge a term into itself");
  });

  it("invokes cms_merge_taxonomy_terms RPC atomically", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
    const { createServiceRoleClient } = await import("@/lib/admin/serviceRole");
    vi.mocked(createServiceRoleClient).mockReturnValue({
      rpc: mockRpc,
    } as any);

    const res = await mergeTerms({
      workspaceId: "ws-1",
      actorAdminUserId: "user-1",
      sourceTermId: "term-src",
      targetTermId: "term-tgt",
    });

    expect(mockRpc).toHaveBeenCalledWith("cms_merge_taxonomy_terms", {
      p_workspace_id: "ws-1",
      p_actor_id: "user-1",
      p_source_term_id: "term-src",
      p_target_term_id: "term-tgt",
    });
    expect(res).toEqual({ ok: true, sourceTermId: "term-src", targetTermId: "term-tgt" });
  });
});
