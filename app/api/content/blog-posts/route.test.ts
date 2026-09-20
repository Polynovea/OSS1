import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/dbAdapter", () => ({
  getDbItems: vi.fn(),
  insertDbItem: vi.fn(),
}));
vi.mock("@/lib/admin/serverAccess", () => ({
  requireAdminRequest: vi.fn(),
}));
vi.mock("@/lib/admin/audit", () => ({
  logAdminActivity: vi.fn(),
}));
vi.mock("@/lib/admin/revalidate", () => ({
  revalidateWebsiteBlog: vi.fn(),
}));

import { getDbItems, insertDbItem } from "@/lib/dbAdapter";
import { requireAdminRequest } from "@/lib/admin/serverAccess";
import { logAdminActivity } from "@/lib/admin/audit";
import { revalidateWebsiteBlog } from "@/lib/admin/revalidate";
import { GET, POST } from "@/app/api/content/blog-posts/route";

const mockGetDbItems = vi.mocked(getDbItems);
const mockInsertDbItem = vi.mocked(insertDbItem);
const mockRequireAdminRequest = vi.mocked(requireAdminRequest);
const mockLogAdminActivity = vi.mocked(logAdminActivity);
const mockRevalidateWebsiteBlog = vi.mocked(revalidateWebsiteBlog);

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

function postRequest(body: unknown): Request {
  return new Request("https://example.com/api/content/blog-posts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/content/blog-posts", () => {
  it("does not require auth and returns whatever dbAdapter returns", async () => {
    mockGetDbItems.mockResolvedValue({ data: [{ id: "1", title: "Hello" }], error: null });
    const res = await GET();
    expect(mockRequireAdminRequest).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual([{ id: "1", title: "Hello" }]);
  });

  it("returns 500 when dbAdapter reports an error", async () => {
    mockGetDbItems.mockResolvedValue({ data: [], error: "db unreachable" });
    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("db unreachable");
  });
});

describe("POST /api/content/blog-posts", () => {
  it("short-circuits with the auth layer's error response when unauthorized", async () => {
    const unauthorized = Response.json({ success: false, data: null, error: "Missing Authorization token" }, { status: 401 });
    mockRequireAdminRequest.mockResolvedValue({ error: unauthorized });

    const res = await POST(postRequest({ title: "Draft" }));
    expect(res.status).toBe(401);
    expect(mockInsertDbItem).not.toHaveBeenCalled();
    expect(mockLogAdminActivity).not.toHaveBeenCalled();
  });

  it("creates the post, logs the activity, and skips revalidation for a draft", async () => {
    mockRequireAdminRequest.mockResolvedValue({ data: { user: {} as never, profile: adminProfile } });
    mockInsertDbItem.mockResolvedValue({ data: { id: "post-1", title: "Draft", status: "draft" }, error: null });

    const res = await POST(postRequest({ title: "Draft", status: "draft" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      expect.objectContaining({ actor: adminProfile, action: "blog_post.create", targetId: "post-1" }),
    );
    expect(mockRevalidateWebsiteBlog).not.toHaveBeenCalled();
  });

  it("revalidates the website when the created post is published", async () => {
    mockRequireAdminRequest.mockResolvedValue({ data: { user: {} as never, profile: adminProfile } });
    mockInsertDbItem.mockResolvedValue({ data: { id: "post-2", slug: "hello-world", status: "published" }, error: null });

    await POST(postRequest({ title: "Hello World", status: "published" }));
    expect(mockRevalidateWebsiteBlog).toHaveBeenCalledWith("hello-world");
  });

  it("returns 500 and does not log activity when the insert fails", async () => {
    mockRequireAdminRequest.mockResolvedValue({ data: { user: {} as never, profile: adminProfile } });
    mockInsertDbItem.mockResolvedValue({ data: null, error: "duplicate slug" });

    const res = await POST(postRequest({ title: "Dup", slug: "dup" }));
    expect(res.status).toBe(500);
    expect(mockLogAdminActivity).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    mockRequireAdminRequest.mockResolvedValue({ data: { user: {} as never, profile: adminProfile } });
    const badReq = new Request("https://example.com/api/content/blog-posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(badReq);
    expect(res.status).toBe(400);
  });
});
