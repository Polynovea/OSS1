import { NextResponse } from "next/server";
import { getDbItems, insertDbItem } from "@/lib/dbAdapter";
import { logAdminActivity } from "@/lib/admin/audit";
import { requireAdminRequest } from "@/lib/admin/serverAccess";
import { revalidateWebsiteBlog } from "@/lib/admin/revalidate";

const ts = () => new Date().toISOString();

export async function GET() {
  const { data, error } = await getDbItems("blog_posts");

  if (error) return NextResponse.json({ success: false, data: null, error, timestamp: ts() }, { status: 500 });
  return NextResponse.json({ success: true, data, error: null, timestamp: ts() });
}

export async function POST(req: Request) {
  const auth = await requireAdminRequest(req, { requiredWriteModule: "cms.blog" });
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const { data, error } = await insertDbItem("blog_posts", body);

    if (error) return NextResponse.json({ success: false, data: null, error, timestamp: ts() }, { status: 500 });
    await logAdminActivity({
      actor: auth.data!.profile,
      action: "blog_post.create",
      targetType: "blog_post",
      targetId: data?.id ?? null,
      targetLabel: data?.title ?? body.title ?? null,
      details: { status: data?.status ?? body.status ?? null },
    });
    if ((data?.status ?? body.status) === "published") {
      await revalidateWebsiteBlog(data?.slug ?? body.slug);
    }
    return NextResponse.json({ success: true, data, error: null, timestamp: ts() }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, data: null, error: err.message || err, timestamp: ts() }, { status: 400 });
  }
}
