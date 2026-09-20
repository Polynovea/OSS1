import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/serviceRole", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { requireAdminRequest } from "@/lib/admin/serverAccess";

const mockCreateServiceRoleClient = vi.mocked(createServiceRoleClient);

interface FakeDbOptions {
  getUser: { data: { user: { id: string; email: string } | null }; error: unknown };
  adminUserRow?: Record<string, unknown> | null;
  adminUserError?: unknown;
}

function fakeDb({ getUser, adminUserRow = null, adminUserError = null }: FakeDbOptions) {
  const query = {
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: adminUserRow, error: adminUserError }),
      }),
    }),
  };
  return {
    auth: { getUser: vi.fn().mockResolvedValue(getUser) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(query),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function reqWithToken(token?: string): Request {
  return new Request("https://example.com/api/test", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

const editorRow = {
  id: "row-1",
  username: "editor",
  email: "editor@example.com",
  role: "editor",
  is_active: true,
  surface_access: ["cms"],
  module_access: ["cms.blog"],
  module_write_access: ["cms.blog"],
};

beforeEach(() => {
  mockCreateServiceRoleClient.mockReset();
});

describe("requireAdminRequest", () => {
  it("rejects requests with no Authorization header", async () => {
    const result = await requireAdminRequest(reqWithToken());
    expect(result.data).toBeUndefined();
    expect(result.error?.status).toBe(401);
  });

  it("returns 500 when the service role key is not configured", async () => {
    mockCreateServiceRoleClient.mockImplementation(() => {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    });
    const result = await requireAdminRequest(reqWithToken("tok"));
    expect(result.error?.status).toBe(500);
  });

  it("rejects an invalid/expired session token", async () => {
    mockCreateServiceRoleClient.mockReturnValue(
      fakeDb({ getUser: { data: { user: null }, error: { message: "invalid" } } }),
    );
    const result = await requireAdminRequest(reqWithToken("bad-token"));
    expect(result.error?.status).toBe(401);
  });

  it("uses the auditable admin_users identity for a provisioned master account", async () => {
    const masterEmail = "owner@example.com";
    const masterRow = { ...editorRow, id: "master-row", username: "owner", email: masterEmail, role: "master" };
    const db = fakeDb({ getUser: { data: { user: { id: "u1", email: masterEmail } }, error: null }, adminUserRow: masterRow });
    mockCreateServiceRoleClient.mockReturnValue(db);
    const result = await requireAdminRequest(reqWithToken("tok"));
    expect(result.error).toBeUndefined();
    expect(result.data?.profile.role).toBe("master");
    expect(result.data?.profile.id).toBe("master-row");
  });

  it("does not self-provision an authenticated identity that lacks an admin_users row", async () => {
    const db = fakeDb({
      getUser: { data: { user: { id: "u1", email: "owner@example.com" } }, error: null },
      adminUserRow: null,
    });
    mockCreateServiceRoleClient.mockReturnValue(db);
    const result = await requireAdminRequest(reqWithToken("tok"));
    expect(result.data).toBeUndefined();
    expect(result.error?.status).toBe(403);
  });

  it("rejects a valid Supabase session with no matching active admin_users row", async () => {
    mockCreateServiceRoleClient.mockReturnValue(
      fakeDb({ getUser: { data: { user: { id: "u2", email: "nobody@example.com" } }, error: null }, adminUserRow: null }),
    );
    const result = await requireAdminRequest(reqWithToken("tok"));
    expect(result.error?.status).toBe(403);
  });

  it("grants access for a matched admin_users row with sufficient read module access", async () => {
    mockCreateServiceRoleClient.mockReturnValue(
      fakeDb({ getUser: { data: { user: { id: "u3", email: "editor@example.com" } }, error: null }, adminUserRow: editorRow }),
    );
    const result = await requireAdminRequest(reqWithToken("tok"), { requiredModule: "cms.blog" });
    expect(result.error).toBeUndefined();
    expect(result.data?.profile.username).toBe("editor");
  });

  it("rejects when the matched user lacks the required write module", async () => {
    // An empty module_write_access falls back to module_access (see access.test.ts),
    // so this must set a *non-empty* write list that excludes the required module.
    mockCreateServiceRoleClient.mockReturnValue(
      fakeDb({
        getUser: { data: { user: { id: "u4", email: "editor@example.com" } }, error: null },
        adminUserRow: { ...editorRow, module_write_access: ["cms.metrics"] },
      }),
    );
    const result = await requireAdminRequest(reqWithToken("tok"), { requiredWriteModule: "cms.blog" });
    expect(result.error?.status).toBe(403);
  });

  it("rejects a non-master user when requireMaster is set, even with full module wildcards", async () => {
    mockCreateServiceRoleClient.mockReturnValue(
      fakeDb({
        getUser: { data: { user: { id: "u5", email: "editor@example.com" } }, error: null },
        adminUserRow: { ...editorRow, module_access: ["*"], module_write_access: ["*"] },
      }),
    );
    const result = await requireAdminRequest(reqWithToken("tok"), { requireMaster: true });
    expect(result.error?.status).toBe(403);
  });

  it("rejects an admin_users row that is not active, even if the Supabase session is valid", async () => {
    mockCreateServiceRoleClient.mockReturnValue(
      fakeDb({
        getUser: { data: { user: { id: "u6", email: "editor@example.com" } }, error: null },
        adminUserError: null,
        // The query itself filters on is_active=true, so a deactivated row resolves as "not found".
        adminUserRow: null,
      }),
    );
    const result = await requireAdminRequest(reqWithToken("tok"));
    expect(result.error?.status).toBe(403);
  });
});
