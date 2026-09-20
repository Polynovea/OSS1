import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { configureLocale, listLocales, resolveLocaleFallback } from "@/lib/content/localizationService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  const url = new URL(req.url);
  const resolve = url.searchParams.get("resolve");
  try {
    if (resolve) {
      return respond(true, { requested: resolve, chain: await resolveLocaleFallback(auth.data!.actor.workspaceId, resolve) }, null);
    }
    return respond(true, await listLocales(auth.data!.actor.workspaceId), null);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Could not load locales", 500);
  }
}

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "workspace.manage" });
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const data = await configureLocale({
      workspaceId: auth.data!.actor.workspaceId,
      actorId: auth.data!.actor.adminUserId,
      locale: body.locale,
      enabled: body.enabled,
      required: body.required,
      isDefault: body.isDefault,
      fallbackLocale: body.fallbackLocale ?? null,
    });
    return respond(true, data, null);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Could not configure locale", 400);
  }
}
