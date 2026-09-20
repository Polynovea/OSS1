import { NextResponse } from "next/server";
import { getDbItem, getDbItemByField, updateDbItem, deleteDbItem } from "@/lib/dbAdapter";
import { logAdminActivity } from "@/lib/admin/audit";
import { requireAdminRequest } from "@/lib/admin/serverAccess";
import { revalidateWebsiteBlog } from "@/lib/admin/revalidate";

const ts = () => new Date().toISOString();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isUuid = UUID_RE.test(id);
  const { data, error } = isUuid
    ? await getDbItem("blog_posts", id)
    : await getDbItemByField("blog_posts", "slug", id);
  if (error) return NextResponse.json({ success: false, data: null, error, timestamp: ts() }, { status: 500 });
  if (!data) return NextResponse.json({ success: false, data: null, error: "Not found", timestamp: ts() }, { status: 404 });
  return NextResponse.json({ success: true, data, error: null, timestamp: ts() });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest(req, { requiredWriteModule: "cms.blog" });
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const body = await req.json();
    const { data, error } = await updateDbItem("blog_posts", id, body);

    if (error) return NextResponse.json({ success: false, data: null, error, timestamp: ts() }, { status: 500 });
    await logAdminActivity({
      actor: auth.data!.profile,
      action: "blog_post.update",
      targetType: "blog_post",
      targetId: id,
      targetLabel: data?.title ?? body.title ?? null,
      details: { status: data?.status ?? body.status ?? null },
    });
    if ((data?.status ?? body.status) === "published") {
      await revalidateWebsiteBlog(data?.slug ?? body.slug);
    }
    return NextResponse.json({ success: true, data, error: null, timestamp: ts() });
  } catch (err: any) {
    return NextResponse.json({ success: false, data: null, error: err.message || err, timestamp: ts() }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest(req, { requiredWriteModule: "cms.blog" });
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const { success, error } = await deleteDbItem("blog_posts", id);

    if (error) return NextResponse.json({ success: false, data: null, error, timestamp: ts() }, { status: 500 });
    await logAdminActivity({
      actor: auth.data!.profile,
      action: "blog_post.delete",
      targetType: "blog_post",
      targetId: id,
    });
    return NextResponse.json({ success, data: null, error: null, timestamp: ts() });
  } catch (err: any) {
    return NextResponse.json({ success: false, data: null, error: err.message || err, timestamp: ts() }, { status: 400 });
  }
}
