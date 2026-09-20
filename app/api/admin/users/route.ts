import { NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { ACCESS_MODULES, normalizeAdminUser, SURFACE_LABELS } from "@/lib/admin/access";
import { logAdminActivity } from "@/lib/admin/audit";
import { requireAdminRequest } from "@/lib/admin/serverAccess";
import { createServiceRoleClient, hasServiceRoleKey } from "@/lib/admin/serviceRole";
import { getSupabaseServerIdentityProvider } from "@/lib/auth/supabaseProvider";
import { syncDefaultWorkspaceMembership } from "@/lib/admin/workspaceMembership";
import type { AdminActivityLog } from "@/lib/admin/types";

const ts = () => new Date().toISOString();

const createUserSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-z0-9._-]+$/i, "Username can only include letters, numbers, dot, underscore, and hyphen"),
  email: z.string().trim().email(),
  display_name: z.string().trim().min(1).max(80),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["master", "admin", "editor", "viewer"]),
  is_active: z.boolean().default(true),
  surface_access: z.array(z.enum(["cms", "content"])).min(1),
  module_access: z.array(z.string()).default([]),
  module_write_access: z.array(z.string()).default([]),
});

export async function GET(req: Request) {
  const auth = await requireAdminRequest(req, { requireMaster: true, requiredModule: "cms.access" });
  if (auth.error) return auth.error;

  const db = createServiceRoleClient();

  const { data, error } = await db
    .from("admin_users")
    .select("*")
    .order("role", { ascending: true })
    .order("username", { ascending: true });

  const { data: activityRows } = await db
    .from("admin_activity_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    return NextResponse.json({ success: false, data: null, error: error.message, timestamp: ts() }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: (data ?? []).map((row) => normalizeAdminUser(row as any)),
    meta: {
      modules: ACCESS_MODULES,
      surfaces: SURFACE_LABELS,
      canCreateAuthUsers: hasServiceRoleKey(),
      activity: (activityRows ?? []) as AdminActivityLog[],
    },
    error: null,
    timestamp: ts(),
  });
}

export async function POST(req: Request) {
  const auth = await requireAdminRequest(req, { requireMaster: true, requiredModule: "cms.access", requiredWriteModule: "cms.access" });
  if (auth.error) return auth.error;

  try {
    const parsed = createUserSchema.parse(await req.json());
    if (parsed.role === "master") {
      return NextResponse.json({ success: false, data: null, error: "Create additional master accounts manually only if absolutely required", timestamp: ts() }, { status: 400 });
    }

    const normalizedEmail = parsed.email.toLowerCase();
    const normalizedUsername = parsed.username.toLowerCase();
    const serviceRoleSupabase = createServiceRoleClient();
    const identity = getSupabaseServerIdentityProvider();

    const allowedModules = new Set(ACCESS_MODULES.map((module) => module.key));
    const filteredModules = parsed.module_access.filter((module) => allowedModules.has(module as any));
    const filteredWriteModules = parsed.module_write_access.filter((module) => allowedModules.has(module as any));

    const { user: authUser, error: authUserError } = await identity.createUser({
      email: normalizedEmail,
      password: parsed.password,
      emailConfirmed: true,
      metadata: {
        username: normalizedUsername,
        display_name: parsed.display_name,
        role: parsed.role,
      },
    });

    if (authUserError || !authUser) {
      return NextResponse.json({
        success: false,
        data: null,
        error: authUserError?.message || "Failed to create auth user",
        timestamp: ts(),
      }, { status: 400 });
    }

    const payload = {
      auth_user_id: authUser.id,
      username: normalizedUsername,
      email: normalizedEmail,
      display_name: parsed.display_name,
      role: parsed.role,
      is_active: parsed.is_active,
      surface_access: parsed.surface_access,
      module_access: filteredModules,
      module_write_access: filteredWriteModules.length ? filteredWriteModules : filteredModules,
      created_by: auth.data?.profile.email ?? "system",
    };

    const { data, error } = await serviceRoleSupabase
      .from("admin_users")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      await identity.deleteUser(authUser.id);
      return NextResponse.json({ success: false, data: null, error: error.message, timestamp: ts() }, { status: 500 });
    }

    try {
      await syncDefaultWorkspaceMembership(data as any, serviceRoleSupabase);
    } catch (membershipError: any) {
      await serviceRoleSupabase.from("admin_users").delete().eq("id", data.id);
      await identity.deleteUser(authUser.id);
      return NextResponse.json({
        success: false,
        data: null,
        error: membershipError?.message || "Failed to create workspace membership",
        timestamp: ts(),
      }, { status: 500 });
    }

    await logAdminActivity({
      actor: auth.data!.profile,
      action: "member.create",
      targetType: "admin_user",
      targetId: data.id,
      targetLabel: `${data.display_name || data.username} <${data.email}>`,
      details: {
        role: data.role,
        surface_access: data.surface_access,
        module_access: data.module_access,
        module_write_access: data.module_write_access,
      },
    });

    return NextResponse.json({
      success: true,
      data: normalizeAdminUser(data as any),
      meta: {
        authUserCreated: true,
        note: "Member credentials were created in Supabase Auth and linked to admin access.",
      },
      error: null,
      timestamp: ts(),
    }, { status: 201 });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      const first = error.issues?.[0];
      const field = first?.path?.[0] ?? "field";
      const msg = first?.message ?? "Validation error";
      return NextResponse.json({ success: false, data: null, error: `${field}: ${msg}`, timestamp: ts() }, { status: 400 });
    }
    return NextResponse.json({ success: false, data: null, error: error.message || "Invalid payload", timestamp: ts() }, { status: 400 });
  }
}
