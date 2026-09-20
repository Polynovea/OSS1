import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { listRedirects, createRedirect } from "@/lib/routing/redirectService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "redirect.read" });
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const locale = searchParams.get("locale") || undefined;

  try {
    const redirects = await listRedirects(auth.data!.actor.workspaceId, locale);
    return respond(true, redirects, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not list redirects", 500);
  }
}

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "redirect.manage" });
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    if (!body.sourcePath || !body.targetPath) {
      return respond(false, null, "sourcePath and targetPath are required", 400);
    }

    const redirect = await createRedirect({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      sourcePath: body.sourcePath,
      targetPath: body.targetPath,
      statusCode: body.statusCode,
      locale: body.locale,
      description: body.description,
      isActive: body.isActive,
    });

    return respond(true, redirect, null, 201);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not create redirect", 400);
  }
}
