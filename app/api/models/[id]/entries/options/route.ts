import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { listEntryOptions } from "@/lib/content/entryService";

const ts = () => new Date().toISOString();

/** {id,label,status}[] for one model's entries — feeds the Visual/Data Studio relation picker. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const options = await listEntryOptions(auth.data!.actor.workspaceId, id);
  return NextResponse.json({ success: true, data: options, error: null, timestamp: ts() });
}
