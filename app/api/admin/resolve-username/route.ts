import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({ success: false, error: "Username sign-in is unavailable; use your email address." }, { status: 410 });
}
