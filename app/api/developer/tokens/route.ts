import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { createDeveloperApiToken, listDeveloperApiTokens } from "@/lib/developer/apiTokenService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) => NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "workspace.manage" });
  if (auth.error) return auth.error;
  try {
    return respond(true, await listDeveloperApiTokens(auth.data!.actor.workspaceId), null);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Could not list API tokens", 500);
  }
}

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "workspace.manage" });
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const result = await createDeveloperApiToken({
      workspaceId: auth.data!.actor.workspaceId,
      actorId: auth.data!.actor.adminUserId,
      name: String(body.name ?? ""),
      scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : [],
      allowedModels: Array.isArray(body.allowedModels) ? body.allowedModels.map(String) : [],
      expiresAt: body.expiresAt ? String(body.expiresAt) : null,
      rateLimitPerMinute: body.rateLimitPerMinute === undefined ? undefined : Number(body.rateLimitPerMinute),
    });
    return respond(true, result, null, 201);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Could not create API token", 400);
  }
}
