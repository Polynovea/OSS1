import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { importRedirects } from "@/lib/routing/redirectService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "redirect.manage" });
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    if (!Array.isArray(body.items)) {
      return respond(false, null, "items must be an array of redirect objects", 400);
    }

    const result = await importRedirects({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      items: body.items,
      dryRun: body.dryRun ?? true,
    });

    return respond(true, result, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not import redirects", 400);
  }
}
