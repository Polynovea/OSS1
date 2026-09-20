import { NextResponse } from "next/server";
import { getDbItems, insertDbItem } from "@/lib/dbAdapter";
import { logAdminActivity } from "@/lib/admin/audit";
import { requireAdminRequest } from "@/lib/admin/serverAccess";

const ts = () => new Date().toISOString();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const entity   = searchParams.get("entity");
  const venueId  = searchParams.get("venue_id");

  const { data, error } = await getDbItems("ad_campaigns");
  if (error) return NextResponse.json({ success: false, data: null, error, timestamp: ts() }, { status: 500 });

  let filtered = data as any[];
  if (venueId)  filtered = filtered.filter((c: any) => c.venue_id === venueId);
  else if (entity) filtered = filtered.filter((c: any) => c.entity === entity);

  return NextResponse.json({ success: true, data: filtered, error: null, timestamp: ts() });
}

export async function POST(req: Request) {
  const auth = await requireAdminRequest(req, { requiredWriteModule: "content.ads" });
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const { data, error } = await insertDbItem("ad_campaigns", body);
    if (error) return NextResponse.json({ success: false, data: null, error, timestamp: ts() }, { status: 500 });
    await logAdminActivity({
      actor: auth.data!.profile,
      action: "ad_campaign.create",
      targetType: "ad_campaign",
      targetId: data?.id ?? null,
      targetLabel: data?.campaign ?? body.campaign ?? null,
      details: { platform: data?.platform ?? body.platform ?? null, entity: data?.entity ?? body.entity ?? null },
    });
    return NextResponse.json({ success: true, data, error: null, timestamp: ts() }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, data: null, error: err.message || err, timestamp: ts() }, { status: 400 });
  }
}
