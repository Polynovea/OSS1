import { createServiceRoleClient } from "@/lib/admin/serviceRole";

export interface WorkflowStageDefinition {
  key: string;
  label: string;
  required_approvals: number;
  required_role_keys: string[];
}

export interface EditorialWorkflowDefinition {
  self_approval: boolean;
  approval_stages: WorkflowStageDefinition[];
}

export interface WorkflowDefinitionRow {
  id: string;
  workspace_id: string;
  name: string;
  content_model_id: string | null;
  definition_json: EditorialWorkflowDefinition;
  active: boolean;
  created_at: string;
  updated_at: string;
  content_models?: { id: string; name: string; api_key: string } | null;
}

function slugKey(value: string, fallback: string) {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return key || fallback;
}

export function normalizeWorkflowDefinition(value: unknown): EditorialWorkflowDefinition {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawStages = Array.isArray(input.approval_stages) ? input.approval_stages : [];
  const stages: WorkflowStageDefinition[] = (rawStages.length ? rawStages : [{ label: "Editorial approval", required_approvals: 1, required_role_keys: [] }])
    .slice(0, 8)
    .map((raw, index) => {
      const stage = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const label = String(stage.label ?? `Approval ${index + 1}`).trim().slice(0, 120) || `Approval ${index + 1}`;
      const parsed = Number(stage.required_approvals ?? 1);
      const requiredApprovals = Number.isInteger(parsed) ? Math.min(10, Math.max(1, parsed)) : 1;
      const roleKeys = Array.isArray(stage.required_role_keys)
        ? [...new Set(stage.required_role_keys.map((item) => String(item).trim()).filter(Boolean))].slice(0, 16)
        : [];
      return {
        key: slugKey(String(stage.key ?? label), `stage_${index + 1}`),
        label,
        required_approvals: requiredApprovals,
        required_role_keys: roleKeys,
      };
    });
  return { self_approval: input.self_approval === true, approval_stages: stages };
}

export async function listWorkflowDefinitions(workspaceId: string): Promise<WorkflowDefinitionRow[]> {
  const { data, error } = await createServiceRoleClient()
    .from("workflow_definitions")
    .select("*, content_models(id,name,api_key)")
    .eq("workspace_id", workspaceId)
    .order("active", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ ...row, definition_json: normalizeWorkflowDefinition(row.definition_json) })) as WorkflowDefinitionRow[];
}

export async function saveWorkflowDefinition(params: {
  workspaceId: string;
  actorId: string;
  definitionId?: string | null;
  name: string;
  contentModelId?: string | null;
  active?: boolean;
  definition: unknown;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Workflow name is required");
  const definition = normalizeWorkflowDefinition(params.definition);
  const { data, error } = await createServiceRoleClient().rpc("cms_upsert_workflow_definition", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorId,
    p_definition_id: params.definitionId ?? null,
    p_name: name,
    p_content_model_id: params.contentModelId ?? null,
    p_definition: definition,
    p_active: params.active ?? true,
  });
  if (error || !data) throw new Error(error?.message || "Could not save workflow definition");
  return data;
}
