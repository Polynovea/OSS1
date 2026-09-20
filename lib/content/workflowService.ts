import { createServiceRoleClient } from "@/lib/admin/serviceRole";

export type WorkflowAction = "submit" | "approve" | "request_changes";
export type WorkflowResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export async function getWorkflow(entryId: string) {
  const { data } = await createServiceRoleClient()
    .from("workflow_instances")
    .select("*, workflow_actions(*), workflow_stage_approvals(*), workflow_definitions(id,name,definition_json)")
    .eq("entry_id", entryId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function transitionWorkflow(params: {
  workspaceId: string;
  entryId: string;
  actorId: string;
  action: WorkflowAction;
  comment?: string;
  canPublish: boolean;
}): Promise<WorkflowResult<unknown>> {
  const { data, error } = await createServiceRoleClient().rpc("cms_transition_workflow", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorId,
    p_entry_id: params.entryId,
    p_action: params.action,
    p_comment: params.comment || null,
    p_can_publish: params.canPublish,
  });

  if (error) {
    const msg = error.message || "Workflow transition failed";
    const code = error.code || "";
    if (code === "40300" || code === "40301" || code === "40302" || msg.includes("cannot approve") || msg.includes("Publishing permission") || msg.includes("workspace role")) {
      return { ok: false, error: msg, status: 403 };
    }
    if (code === "P0002" || msg.includes("required") || msg.includes("not found")) {
      return { ok: false, error: msg, status: 404 };
    }
    if (code === "P0003" || msg.includes("Only a draft") || msg.includes("already exists") || msg.includes("No review")) {
      return { ok: false, error: msg, status: 409 };
    }
    return { ok: false, error: msg, status: 400 };
  }
  return { ok: true, data };
}
