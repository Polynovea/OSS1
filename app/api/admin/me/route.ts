import { NextResponse } from "next/server";
import { z } from "zod";
import { logAdminActivity } from "@/lib/admin/audit";
import { normalizeAdminUser } from "@/lib/admin/access";
import { requireAdminRequest } from "@/lib/admin/serverAccess";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { getSupabaseServerIdentityProvider } from "@/lib/auth/supabaseProvider";

const ts = () => new Date().toISOString();

const updateProfileSchema = z.object({
  display_name: z.string().trim().min(1, "Display name is required").max(80).optional(),
  password: z.string().min(8, "Password must be at least 8 characters").max(128).optional(),
}).refine((value) => value.display_name !== undefined || value.password !== undefined, {
  message: "Nothing to update",
});

export async function GET(req: Request) {
  const auth = await requireAdminRequest(req);
  if (auth.error) return auth.error;
  return NextResponse.json({ success: true, data: auth.data!.profile, error: null, timestamp: ts() });
}

export async function PATCH(req: Request) {
  const auth = await requireAdminRequest(req);
  if (auth.error) return auth.error;

  try {
    const parsed = updateProfileSchema.parse(await req.json());
    const db = createServiceRoleClient();
    const identity = getSupabaseServerIdentityProvider();
    const profile = auth.data!.profile;
    const authUser = auth.data!.user;

    let updatedProfile = profile;

    if (parsed.display_name !== undefined) {
      const { data, error } = await db
        .from("admin_users")
        .update({
          display_name: parsed.display_name,
          updated_at: ts(),
        })
        .eq("id", profile.id)
        .select("*")
        .single();

      if (error || !data) {
        return NextResponse.json(
          { success: false, data: null, error: error?.message || "Could not update profile", timestamp: ts() },
          { status: 500 },
        );
      }

      updatedProfile = normalizeAdminUser(data as any);

      const currentMetadata = authUser.user_metadata && typeof authUser.user_metadata === "object"
        ? authUser.user_metadata
        : {};

      const { error: metadataError } = await identity.updateUser(authUser.id, {
        metadata: {
          ...currentMetadata,
          username: updatedProfile.username,
          display_name: parsed.display_name,
          role: updatedProfile.role,
        },
      });

      if (metadataError) {
        return NextResponse.json(
          { success: false, data: null, error: metadataError.message, timestamp: ts() },
          { status: 400 },
        );
      }
    }

    if (parsed.password !== undefined) {
      const { error: passwordError } = await identity.updateUser(authUser.id, {
        password: parsed.password,
      });

      if (passwordError) {
        return NextResponse.json(
          { success: false, data: null, error: passwordError.message, timestamp: ts() },
          { status: 400 },
        );
      }
    }

    await logAdminActivity({
      actor: updatedProfile,
      action: parsed.password ? "profile.update_with_password" : "profile.update",
      targetType: "admin_user",
      targetId: updatedProfile.id,
      targetLabel: `${updatedProfile.display_name || updatedProfile.username} <${updatedProfile.email}>`,
      details: {
        changed_display_name: parsed.display_name !== undefined,
        changed_password: parsed.password !== undefined,
      },
    });

    return NextResponse.json({ success: true, data: updatedProfile, error: null, timestamp: ts() });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      const first = error.issues?.[0];
      return NextResponse.json(
        { success: false, data: null, error: first?.message || "Invalid profile update", timestamp: ts() },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { success: false, data: null, error: error?.message || "Could not update profile", timestamp: ts() },
      { status: 400 },
    );
  }
}
