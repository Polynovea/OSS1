import { NextResponse } from "next/server";
import { deleteDbItem, updateDbItem } from "@/lib/dbAdapter";
import { logAdminActivity } from "@/lib/admin/audit";
import { requireAdminRequest } from "@/lib/admin/serverAccess";

const ts = () => new Date().toISOString();

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest(req, { requiredWriteModule: "content.library" });
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const { success, error } = await deleteDbItem("social_posts", id);

    if (error) return NextResponse.json({ success: false, data: null, error, timestamp: ts() }, { status: 500 });
    await logAdminActivity({
      actor: auth.data!.profile,
      action: "social_post.delete",
      targetType: "social_post",
      targetId: id,
    });
    return NextResponse.json({ success, data: null, error: null, timestamp: ts() });
  } catch (err: any) {
    return NextResponse.json({ success: false, data: null, error: err.message || err, timestamp: ts() }, { status: 400 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest(req, { requiredWriteModule: "content.library" });
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const body = await req.json();
    const { data, error } = await updateDbItem("social_posts", id, body);
    if (error) return NextResponse.json({ success: false, data: null, error, timestamp: ts() }, { status: 500 });
    await logAdminActivity({
      actor: auth.data!.profile,
      action: "social_post.update",
      targetType: "social_post",
      targetId: id,
      targetLabel: data?.title ?? body.title ?? null,
      details: { platform: data?.platform ?? body.platform ?? null, status: data?.status ?? body.status ?? null },
    });
    return NextResponse.json({ success: true, data, error: null, timestamp: ts() });
  } catch (err: any) {
    return NextResponse.json({ success: false, data: null, error: err.message || err, timestamp: ts() }, { status: 400 });
  }
}
