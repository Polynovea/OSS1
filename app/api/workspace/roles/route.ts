import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { listWorkspaceRoles } from "@/lib/platform/actor";

const ts = () => new Date().toISOString();

/** Read-only role list for the schema studio's permission-policy editor. */
export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "users.read" });
  if (auth.error) return auth.error;

  const roles = await listWorkspaceRoles(auth.data!.actor.workspaceId);
  return NextResponse.json({ success: true, data: roles, error: null, timestamp: ts() });
}
