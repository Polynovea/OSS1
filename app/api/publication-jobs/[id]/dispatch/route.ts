import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { dispatchPublicationJob } from "@/lib/content/publicationService";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) { const auth = await requirePlatformAccess(req, { permission: "content.entry.publish" }); if (auth.error) return auth.error; try { const { id } = await params; return NextResponse.json({ success: true, data: await dispatchPublicationJob(auth.data!.actor.workspaceId, id), error: null }); } catch (error) { return NextResponse.json({ success: false, data: null, error: error instanceof Error ? error.message : "Could not dispatch job" }, { status: 400 }); } }
