import { NextResponse } from "next/server";

/** Ordered Supabase migrations replaced this legacy runtime-DDL endpoint. */
export async function POST() {
  return NextResponse.json({ success: false, error: "Runtime migrations are disabled; use the ordered migration system." }, { status: 410 });
}
