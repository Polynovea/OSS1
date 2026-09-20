import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { listPublicationJobs } from "@/lib/content/publicationService";
export async function GET(req: Request) { const auth = await requirePlatformAccess(req, { permission: "content.entry.read" }); if (auth.error) return auth.error; return NextResponse.json({ success: true, data: await listPublicationJobs(auth.data!.actor.workspaceId, new URL(req.url).searchParams.get("entryId") ?? undefined), error: null }); }
