import { NextResponse } from "next/server";
import { z } from "zod";
import { ACCESS_MODULES, normalizeAdminUser } from "@/lib/admin/access";
import { logAdminActivity } from "@/lib/admin/audit";
import { requireAdminRequest } from "@/lib/admin/serverAccess";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { syncDefaultWorkspaceMembership } from "@/lib/admin/workspaceMembership";
import { getSupabaseServerIdentityProvider } from "@/lib/auth/supabaseProvider";

const ts = () => new Date().toISOString();

const updateUserSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  role: z.enum(["master", "admin", "editor", "viewer"]),
  is_active: z.boolean(),
  surface_access: z.array(z.enum(["cms", "content"])).min(1),
  module_access: z.array(z.string()),
  module_write_access: z.array(z.string()),
  password: z.string().min(8, "Password must be at least 8 characters").optional().or(z.literal("")),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminRequest(req, { requireMaster: true, requiredModule: "cms.access", requiredWriteModule: "cms.access" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const db = createServiceRoleClient();
  const identity = getSupabaseServerIdentityProvider();

  try {
    const parsed = updateUserSchema.parse(await req.json());
    const allowedModules = new Set(ACCESS_MODULES.map((module) => module.key));
    const filteredModules = parsed.module_access.filter((module) => allowedModules.has(module as any));
    const filteredWriteModules = parsed.module_write_access.filter((module) => allowedModules.has(module as any));

    const { data: existing, error: existingError } = await db
      .from("admin_users")
      .select("*")
      .eq("id", id)
      .single();

    if (existingError || !existing) {
      return NextResponse.json({ success: false, data: null, error: "User profile not found", timestamp: ts() }, { status: 404 });
    }

    if (existing.role === "master") {
      return NextResponse.json({ success: false, data: null, error: "The master account is locked from editing in this panel", timestamp: ts() }, { status: 400 });
    }

    if (parsed.password && existing.auth_user_id) {
      const { error: passwordError } = await identity.updateUser(
        existing.auth_user_id,
        {
          password: parsed.password,
          metadata: {
            username: existing.username,
            display_name: parsed.display_name,
            role: parsed.role,
          },
        },
      );

      if (passwordError) {
        return NextResponse.json({ success: false, data: null, error: passwordError.message, timestamp: ts() }, { status: 400 });
      }
    }

    const { data, error } = await db
      .from("admin_users")
      .update({
        display_name: parsed.display_name,
        role: parsed.role,
        is_active: parsed.is_active,
        surface_access: parsed.surface_access,
        module_access: filteredModules,
        module_write_access: filteredWriteModules.length ? filteredWriteModules : filteredModules,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ success: false, data: null, error: error.message, timestamp: ts() }, { status: 500 });
    }

    try {
      await syncDefaultWorkspaceMembership(data as any, db);
    } catch (membershipError: any) {
      return NextResponse.json({
        success: false,
        data: null,
        error: membershipError?.message || "Failed to synchronize workspace membership",
        timestamp: ts(),
      }, { status: 500 });
    }

    await logAdminActivity({
      actor: auth.data!.profile,
      action: parsed.password ? "member.update_with_password_reset" : "member.update",
      targetType: "admin_user",
      targetId: data.id,
      targetLabel: `${data.display_name || data.username} <${data.email}>`,
      details: {
        role: data.role,
        is_active: data.is_active,
        surface_access: data.surface_access,
        module_access: data.module_access,
        module_write_access: data.module_write_access,
      },
    });

    return NextResponse.json({ success: true, data: normalizeAdminUser(data as any), error: null, timestamp: ts() });
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

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminRequest(req, { requireMaster: true, requiredModule: "cms.access", requiredWriteModule: "cms.access" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const db = createServiceRoleClient();
  const identity = getSupabaseServerIdentityProvider();

  const { data: existing, error: existingError } = await db
    .from("admin_users")
    .select("*")
    .eq("id", id)
    .single();

  if (existingError || !existing) {
    return NextResponse.json({ success: false, data: null, error: "User profile not found", timestamp: ts() }, { status: 404 });
  }

  if (existing.role === "master") {
    return NextResponse.json({ success: false, data: null, error: "The master account cannot be deleted", timestamp: ts() }, { status: 400 });
  }

  if (existing.auth_user_id) {
    const { error: authDeleteError } = await identity.deleteUser(existing.auth_user_id);
    if (authDeleteError) {
      return NextResponse.json({ success: false, data: null, error: authDeleteError.message, timestamp: ts() }, { status: 400 });
    }
  }

  const { error } = await db.from("admin_users").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ success: false, data: null, error: error.message, timestamp: ts() }, { status: 500 });
  }

  await logAdminActivity({
    actor: auth.data!.profile,
    action: "member.delete",
    targetType: "admin_user",
    targetId: existing.id,
    targetLabel: `${existing.display_name || existing.username} <${existing.email}>`,
    details: {
      role: existing.role,
      auth_user_id: existing.auth_user_id,
    },
  });

  return NextResponse.json({ success: true, data: null, error: null, timestamp: ts() });
}
