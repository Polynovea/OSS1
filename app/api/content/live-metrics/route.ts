import { NextResponse } from "next/server";
import { getDbItems, insertDbItem, bulkUpsertMetrics } from "@/lib/dbAdapter";
import { logAdminActivity } from "@/lib/admin/audit";
import { requireAdminRequest } from "@/lib/admin/serverAccess";

const ts = () => new Date().toISOString();

function toDb(body: any) {
  const { trendDirection, ...rest } = body;
  return {
    ...rest,
    ...(trendDirection !== undefined && { trend_direction: trendDirection }),
  };
}

function fromDb(row: any) {
  if (!row) return row;
  const { trend_direction, ...rest } = row;
  return { ...rest, trendDirection: trend_direction };
}

export async function GET() {
  const { data, error } = await getDbItems("live_metrics");

  if (error) return NextResponse.json({ success: false, data: null, error, timestamp: ts() }, { status: 500 });
  return NextResponse.json({ success: true, data: (data as any[]).map(fromDb), error: null, timestamp: ts() });
}

export async function POST(req: Request) {
  const auth = await requireAdminRequest(req, { requiredWriteModule: "cms.metrics" });
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const { data, error } = await insertDbItem("live_metrics", toDb(body));

    if (error) return NextResponse.json({ success: false, data: null, error, timestamp: ts() }, { status: 500 });
    await logAdminActivity({
      actor: auth.data!.profile,
      action: "metric.create",
      targetType: "live_metric",
      targetId: data?.id ? String(data.id) : null,
      targetLabel: data?.label ?? body.label ?? null,
      details: { value: data?.value ?? body.value ?? null },
    });
    return NextResponse.json({ success: true, data: fromDb(data), error: null, timestamp: ts() }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, data: null, error: err.message || err, timestamp: ts() }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  const auth = await requireAdminRequest(req, { requiredWriteModule: "cms.metrics" });
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const { data, error } = await bulkUpsertMetrics((body as any[]).map(toDb));

    if (error) return NextResponse.json({ success: false, data: null, error, timestamp: ts() }, { status: 500 });
    await logAdminActivity({
      actor: auth.data!.profile,
      action: "metric.bulk_upsert",
      targetType: "live_metric",
      targetLabel: "Metrics set",
      details: { count: Array.isArray(data) ? data.length : 0 },
    });
    return NextResponse.json({ success: true, data: Array.isArray(data) ? data.map(fromDb) : data, error: null, timestamp: ts() });
  } catch (err: any) {
    return NextResponse.json({ success: false, data: null, error: err.message || err, timestamp: ts() }, { status: 400 });
  }
}
