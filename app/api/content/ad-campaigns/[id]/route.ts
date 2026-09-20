import { NextResponse } from "next/server";
import { deleteDbItem, updateDbItem } from "@/lib/dbAdapter";
import { logAdminActivity } from "@/lib/admin/audit";
import { requireAdminRequest } from "@/lib/admin/serverAccess";

const ts = () => new Date().toISOString();

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest(req, { requiredWriteModule: "content.ads" });
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const { success, error } = await deleteDbItem("ad_campaigns", id);

    if (error) return NextResponse.json({ success: false, data: null, error, timestamp: ts() }, { status: 500 });
    await logAdminActivity({
      actor: auth.data!.profile,
      action: "ad_campaign.delete",
      targetType: "ad_campaign",
      targetId: id,
    });
    return NextResponse.json({ success, data: null, error: null, timestamp: ts() });
  } catch (err: any) {
    return NextResponse.json({ success: false, data: null, error: err.message || err, timestamp: ts() }, { status: 400 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest(req, { requiredWriteModule: "content.ads" });
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const body = await req.json();
    const { data, error } = await updateDbItem("ad_campaigns", id, body);
    if (error) return NextResponse.json({ success: false, data: null, error, timestamp: ts() }, { status: 500 });
    await logAdminActivity({
      actor: auth.data!.profile,
      action: "ad_campaign.update",
      targetType: "ad_campaign",
      targetId: id,
      targetLabel: data?.campaign ?? body.campaign ?? null,
      details: { platform: data?.platform ?? body.platform ?? null, status: data?.status ?? body.status ?? null },
    });
    return NextResponse.json({ success: true, data, error: null, timestamp: ts() });
  } catch (err: any) {
    return NextResponse.json({ success: false, data: null, error: err.message || err, timestamp: ts() }, { status: 400 });
  }
}
