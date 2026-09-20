import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { listWorkflowDefinitions, saveWorkflowDefinition } from "@/lib/content/workflowDefinitionService";
import { listModels } from "@/lib/schema/modelService";
import { listWorkspaceRoles } from "@/lib/platform/actor";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  try {
    const [definitions, models, roles] = await Promise.all([
      listWorkflowDefinitions(auth.data!.actor.workspaceId),
      listModels(auth.data!.actor.workspaceId),
      listWorkspaceRoles(auth.data!.actor.workspaceId),
    ]);
    return respond(true, { definitions, models, roles }, null);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Could not load workflows", 500);
  }
}

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "workspace.manage" });
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const data = await saveWorkflowDefinition({
      workspaceId: auth.data!.actor.workspaceId,
      actorId: auth.data!.actor.adminUserId,
      definitionId: body.id ?? null,
      name: body.name,
      contentModelId: body.contentModelId ?? null,
      active: body.active ?? true,
      definition: {
        self_approval: body.selfApproval === true,
        approval_stages: body.stages,
      },
    });
    return respond(true, data, null, body.id ? 200 : 201);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Could not save workflow", 400);
  }
}
