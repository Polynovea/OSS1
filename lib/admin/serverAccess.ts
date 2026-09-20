import type { User } from "@supabase/supabase-js";
import { hasModuleAccess, hasModuleWriteAccess, normalizeAdminUser, type AdminModule } from "@/lib/admin/access";
import type { AdminUser } from "@/lib/admin/types";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { getSupabaseServerIdentityProvider } from "@/lib/auth/supabaseProvider";

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim();
}

export interface AdminRequestContext {
  user: User;
  profile: AdminUser;
}

export async function requireAdminRequest(
  req: Request,
  options: { requireMaster?: boolean; requiredModule?: AdminModule | AdminModule[]; requiredWriteModule?: AdminModule | AdminModule[] } = {},
): Promise<{ data?: AdminRequestContext; error?: Response }> {
  const token = getBearerToken(req);
  if (!token) {
    return {
      error: Response.json(
        { success: false, data: null, error: "Missing Authorization token", timestamp: new Date().toISOString() },
        { status: 401 },
      ),
    };
  }

  let serviceDb: ReturnType<typeof createServiceRoleClient>;
  try {
    serviceDb = createServiceRoleClient();
  } catch {
    return {
      error: Response.json(
        { success: false, data: null, error: "Missing SUPABASE_SERVICE_ROLE_KEY", timestamp: new Date().toISOString() },
        { status: 500 },
      ),
    };
  }

  const identity = getSupabaseServerIdentityProvider();
  const { user, error: userError } = await identity.verifyBearerToken(token);

  if (userError || !user) {
    return {
      error: Response.json(
        { success: false, data: null, error: "Invalid session", timestamp: new Date().toISOString() },
        { status: 401 },
      ),
    };
  }

  const email = user.email?.toLowerCase() || "";
  let profile: AdminUser | null = null;

  try {
    const { data } = await serviceDb
      .from("admin_users")
      .select("*")
      .eq("email", email)
      .eq("is_active", true)
      .maybeSingle();

    profile = data ? normalizeAdminUser(data as AdminUser) : null;
  } catch {
    profile = null;
  }

  if (!profile) {
    return {
      error: Response.json(
        { success: false, data: null, error: "Access denied", timestamp: new Date().toISOString() },
        { status: 403 },
      ),
    };
  }

  if (options.requireMaster && profile.role !== "master") {
    return {
      error: Response.json(
        { success: false, data: null, error: "Master access required", timestamp: new Date().toISOString() },
        { status: 403 },
      ),
    };
  }

  const requiredModules = options.requiredModule
    ? (Array.isArray(options.requiredModule) ? options.requiredModule : [options.requiredModule])
    : [];
  const requiredWriteModules = options.requiredWriteModule
    ? (Array.isArray(options.requiredWriteModule) ? options.requiredWriteModule : [options.requiredWriteModule])
    : [];

  if (requiredModules.length > 0 && !requiredModules.some((module) => hasModuleAccess(profile, module))) {
    return {
      error: Response.json(
        { success: false, data: null, error: "You do not have access to this module", timestamp: new Date().toISOString() },
        { status: 403 },
      ),
    };
  }

  if (requiredWriteModules.length > 0 && !requiredWriteModules.some((module) => hasModuleWriteAccess(profile, module))) {
    return {
      error: Response.json(
        { success: false, data: null, error: "You do not have write access to this module", timestamp: new Date().toISOString() },
        { status: 403 },
      ),
    };
  }

  return { data: { user, profile } };
}
