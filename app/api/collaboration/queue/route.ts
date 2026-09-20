import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getMyEditorialQueue } from "@/lib/content/collaborationService";
export async function GET(req: Request) { const auth = await requirePlatformAccess(req, { permission: "content.entry.read" }); if (auth.error) return auth.error; const result = await getMyEditorialQueue(auth.data!.actor.workspaceId, auth.data!.actor.adminUserId); return NextResponse.json({ success: result.ok, data: result.ok ? result.data : null, error: result.ok ? null : result.error, timestamp: new Date().toISOString() }, { status: result.ok ? 200 : result.status }); }
