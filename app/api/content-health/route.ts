import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getContentHealth } from "@/lib/content/healthService";
export async function GET(req: Request) { const auth = await requirePlatformAccess(req, { permission: "content.entry.read" }); if (auth.error) return auth.error; return NextResponse.json({ success: true, data: await getContentHealth(auth.data!.actor.workspaceId), error: null }); }
