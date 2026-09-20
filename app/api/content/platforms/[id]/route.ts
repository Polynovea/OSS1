import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logAdminActivity } from "@/lib/admin/audit";
import { requireAdminRequest } from "@/lib/admin/serverAccess";

const ts = () => new Date().toISOString();

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest(req, { requiredWriteModule: "content.platforms" });
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    const body = await req.json();
    const db = createServiceRoleClient();
    const { data, error } = await db
      .from("platforms")
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ success: false, data: null, error: error.message, timestamp: ts() }, { status: 500 });

    await logAdminActivity({
      actor: auth.data!.profile,
      action: "platform.update",
      targetType: "platform",
      targetId: id,
      targetLabel: data?.name ?? null,
      details: body,
    });

    return NextResponse.json({ success: true, data, error: null, timestamp: ts() });
  } catch (err: any) {
    return NextResponse.json({ success: false, data: null, error: err.message || err, timestamp: ts() }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest(req, { requiredWriteModule: "content.platforms" });
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    const db = createServiceRoleClient();
    const { error } = await db.from("platforms").delete().eq("id", id);
    if (error) return NextResponse.json({ success: false, data: null, error: error.message, timestamp: ts() }, { status: 500 });

    await logAdminActivity({
      actor: auth.data!.profile,
      action: "platform.delete",
      targetType: "platform",
      targetId: id,
    });

    return NextResponse.json({ success: true, data: null, error: null, timestamp: ts() });
  } catch (err: any) {
    return NextResponse.json({ success: false, data: null, error: err.message || err, timestamp: ts() }, { status: 400 });
  }
}
