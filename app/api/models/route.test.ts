import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/permissions", () => ({
  requirePlatformAccess: vi.fn(),
}));
vi.mock("@/lib/schema/modelService", () => ({
  createModel: vi.fn(),
  listModels: vi.fn(),
}));

import { requirePlatformAccess } from "@/lib/platform/permissions";
import { createModel, listModels } from "@/lib/schema/modelService";
import { GET, POST } from "@/app/api/models/route";
import type { CmsActor } from "@/lib/platform/types";

const mockRequirePlatformAccess = vi.mocked(requirePlatformAccess);
const mockCreateModel = vi.mocked(createModel);
const mockListModels = vi.mocked(listModels);

const actor: CmsActor = {
  adminUserId: "admin-1",
  workspaceId: "ws-1",
  workspaceMemberId: "wm-1",
  roleKeys: ["admin"],
  permissions: new Set(["schema.read", "schema.manage"]),
  isMasterBypass: false,
};

const adminUser = {
  id: "admin-1",
  auth_user_id: "auth-1",
  username: "editor",
  email: "editor@example.com",
  display_name: "Editor",
  role: "admin" as const,
  is_active: true,
  surface_access: ["cms"],
  module_access: ["*"],
  module_write_access: ["*"],
  created_by: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function postReq(body: unknown): Request {
  return new Request("https://example.com/api/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/models", () => {
  it("passes through the auth layer's error when access is denied", async () => {
    const denied = Response.json({ success: false, data: null, error: "Missing required permission" }, { status: 403 });
    mockRequirePlatformAccess.mockResolvedValue({ error: denied });

    const res = await GET(new Request("https://example.com/api/models"));
    expect(res.status).toBe(403);
    expect(mockListModels).not.toHaveBeenCalled();
  });

  it("lists models scoped to the actor's workspace", async () => {
    mockRequirePlatformAccess.mockResolvedValue({ data: { actor, adminUser } });
    mockListModels.mockResolvedValue([{ id: "model-1" } as never]);

    const res = await GET(new Request("https://example.com/api/models"));
    expect(res.status).toBe(200);
    expect(mockListModels).toHaveBeenCalledWith("ws-1");
    const json = await res.json();
    expect(json.data).toEqual([{ id: "model-1" }]);
  });
});

describe("POST /api/models", () => {
  it("creates a model and returns 201 on success", async () => {
    mockRequirePlatformAccess.mockResolvedValue({ data: { actor, adminUser } });
    mockCreateModel.mockResolvedValue({ ok: true, data: { model: { id: "model-1" } as never, version: { id: "v1" } as never } });

    const res = await POST(postReq({ schema: { name: "Blog Post", apiKey: "blog_post", fields: [] } }));
    expect(res.status).toBe(201);
    expect(mockCreateModel).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", createdBy: "admin-1" }),
    );
  });

  it("returns the service's status/error when creation fails (e.g. duplicate apiKey)", async () => {
    mockRequirePlatformAccess.mockResolvedValue({ data: { actor, adminUser } });
    mockCreateModel.mockResolvedValue({ ok: false, error: "duplicate", status: 409 });

    const res = await POST(postReq({ schema: { name: "Blog Post", apiKey: "blog_post", fields: [] } }));
    expect(res.status).toBe(409);
  });

  it("returns 400 for malformed JSON", async () => {
    mockRequirePlatformAccess.mockResolvedValue({ data: { actor, adminUser } });
    const badReq = new Request("https://example.com/api/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(badReq);
    expect(res.status).toBe(400);
  });
});
