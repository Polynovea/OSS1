import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logAdminActivity } from "@/lib/admin/audit";
import { requireAdminRequest } from "@/lib/admin/serverAccess";

const ts = () => new Date().toISOString();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const forCategory = searchParams.get("for");

  const db = createServiceRoleClient();
  let query = db.from("platforms").select("*").order("sort_order", { ascending: true });

  if (forCategory === "social") query = query.eq("is_active", true).eq("for_social", true);
  if (forCategory === "ads") query = query.eq("is_active", true).eq("for_ads", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, data: null, error: error.message, timestamp: ts() }, { status: 500 });
  return NextResponse.json({ success: true, data, error: null, timestamp: ts() });
}

export async function POST(req: Request) {
  const auth = await requireAdminRequest(req, { requiredWriteModule: "content.platforms" });
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json({ success: false, data: null, error: "Name is required", timestamp: ts() }, { status: 400 });
    }

    const db = createServiceRoleClient();
    const { data: maxRow } = await db
      .from("platforms")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = (maxRow?.sort_order ?? -1) + 1;

    const { data, error } = await db
      .from("platforms")
      .insert({
        name,
        for_social: body.for_social ?? true,
        for_ads: body.for_ads ?? false,
        is_active: true,
        sort_order: nextSort,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ success: false, data: null, error: error.message, timestamp: ts() }, { status: 500 });

    await logAdminActivity({
      actor: auth.data!.profile,
      action: "platform.create",
      targetType: "platform",
      targetId: data?.id ?? null,
      targetLabel: data?.name ?? name,
    });

    return NextResponse.json({ success: true, data, error: null, timestamp: ts() }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, data: null, error: err.message || err, timestamp: ts() }, { status: 400 });
  }
}
