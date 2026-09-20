import { describe, expect, it, vi, beforeEach } from "vitest";
import { transitionWorkflow, getWorkflow } from "./workflowService";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";

vi.mock("@/lib/admin/serviceRole", () => ({
  createServiceRoleClient: vi.fn(),
}));

describe("workflowService unit tests", () => {
  let mockRpc: any;
  let mockFrom: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc = vi.fn();
    mockFrom = vi.fn();
    vi.mocked(createServiceRoleClient).mockReturnValue({
      rpc: mockRpc,
      from: mockFrom,
    } as any);
  });

  it("1. calls cms_transition_workflow and returns ok: true with data", async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, instance_id: "inst-1", state: "in_review" },
      error: null,
    });

    const res = await transitionWorkflow({
      workspaceId: "ws-1",
      entryId: "ent-1",
      actorId: "actor-1",
      action: "submit",
      comment: "Please review",
      canPublish: false,
    });

    expect(mockRpc).toHaveBeenCalledWith("cms_transition_workflow", {
      p_workspace_id: "ws-1",
      p_actor_id: "actor-1",
      p_entry_id: "ent-1",
      p_action: "submit",
      p_comment: "Please review",
      p_can_publish: false,
    });
    expect(res).toEqual({
      ok: true,
      data: { success: true, instance_id: "inst-1", state: "in_review" },
    });
  });

  it("2. sets p_comment to null if comment is omitted or empty", async () => {
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    await transitionWorkflow({
      workspaceId: "ws-1",
      entryId: "ent-1",
      actorId: "actor-1",
      action: "submit",
      canPublish: false,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "cms_transition_workflow",
      expect.objectContaining({ p_comment: null })
    );
  });

  it("3. passes canPublish: true when user possesses publish rights", async () => {
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    await transitionWorkflow({
      workspaceId: "ws-1",
      entryId: "ent-1",
      actorId: "actor-1",
      action: "approve",
      canPublish: true,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "cms_transition_workflow",
      expect.objectContaining({ p_can_publish: true })
    );
  });

  it("4. maps code 40300 (self-approval forbidden) to status 403", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "40300", message: "A requester cannot approve their own review" },
    });

    const res = await transitionWorkflow({
      workspaceId: "ws-1",
      entryId: "ent-1",
      actorId: "actor-1",
      action: "approve",
      canPublish: true,
    });

    expect(res).toEqual({
      ok: false,
      error: "A requester cannot approve their own review",
      status: 403,
    });
  });

  it("5. maps 'cannot approve' in message to status 403", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Self-approval check: cannot approve own submission" },
    });

    const res = await transitionWorkflow({
      workspaceId: "ws-1",
      entryId: "ent-1",
      actorId: "actor-1",
      action: "approve",
      canPublish: true,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
    }
  });

  it("6. maps code 40301 (publishing permission required) to status 403", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "40301", message: "Publishing permission is required for review decisions" },
    });

    const res = await transitionWorkflow({
      workspaceId: "ws-1",
      entryId: "ent-1",
      actorId: "actor-1",
      action: "approve",
      canPublish: false,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
    }
  });

  it("7. maps code P0002 (entry/draft not found) to status 404", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "Entry with a draft is required" },
    });

    const res = await transitionWorkflow({
      workspaceId: "ws-1",
      entryId: "ent-1",
      actorId: "actor-1",
      action: "submit",
      canPublish: false,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(404);
    }
  });

  it("8. maps code P0003 (workflow conflict / active review exists) to status 409", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0003", message: "An active review already exists" },
    });

    const res = await transitionWorkflow({
      workspaceId: "ws-1",
      entryId: "ent-1",
      actorId: "actor-1",
      action: "submit",
      canPublish: false,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(409);
    }
  });

  it("9. maps concurrent reviewer conflict error to status 409", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0003", message: "Workflow state conflict: review has already been decided or completed" },
    });

    const res = await transitionWorkflow({
      workspaceId: "ws-1",
      entryId: "ent-1",
      actorId: "actor-2",
      action: "request_changes",
      canPublish: true,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(409);
      expect(res.error).toContain("conflict");
    }
  });

  it("10. maps general unknown database errors to status 400", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "Unsupported workflow action: bogus" },
    });

    const res = await transitionWorkflow({
      workspaceId: "ws-1",
      entryId: "ent-1",
      actorId: "actor-1",
      action: "submit" as any,
      canPublish: false,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
    }
  });

  it("11. getWorkflow queries workflow_instances with actions in descending order", async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "inst-1",
        current_state: "in_review",
        workflow_actions: [{ id: "act-1", action: "submitted" }],
      },
    });
    const mockLimit = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockEq = vi.fn().mockReturnValue({ order: mockOrder });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });

    mockFrom.mockReturnValue({ select: mockSelect });

    const wf = await getWorkflow("ent-123");

    expect(mockFrom).toHaveBeenCalledWith("workflow_instances");
    expect(mockSelect).toHaveBeenCalledWith("*, workflow_actions(*), workflow_stage_approvals(*), workflow_definitions(id,name,definition_json)");
    expect(mockEq).toHaveBeenCalledWith("entry_id", "ent-123");
    expect(mockOrder).toHaveBeenCalledWith("started_at", { ascending: false });
    expect(wf?.id).toBe("inst-1");
  });

  it("12. getWorkflow returns null when no workflow instance exists", async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null });
    const mockLimit = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockEq = vi.fn().mockReturnValue({ order: mockOrder });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });

    mockFrom.mockReturnValue({ select: mockSelect });

    const wf = await getWorkflow("ent-456");
    expect(wf).toBeNull();
  });
});
