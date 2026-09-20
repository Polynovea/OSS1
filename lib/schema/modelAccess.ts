import { getModel, getVersion, type ContentModelRow } from "@/lib/schema/modelService";
import type { ModelOperation } from "@/lib/schema/fields/types";
import type { CmsActor } from "@/lib/platform/types";
import { getEntry } from "@/lib/content/entryService";

export type ModelAccessResult =
  | { allowed: true }
  | { allowed: false; error: string; status: 403 | 404 | 500 };

/**
 * Evaluates the model-level policy stored in the immutable canonical schema.
 * Workspace permissions are deliberately checked by the route first; this is
 * an additional per-model restriction, not a second replacement permission
 * system. A model without policy rows preserves the workspace default.
 */
export async function canActorOperateModel(
  actor: CmsActor,
  model: ContentModelRow,
  operation: ModelOperation,
): Promise<ModelAccessResult> {
  if (actor.isMasterBypass) return { allowed: true };

  const version = await getVersion(model.id, model.current_schema_version);
  if (!version) return { allowed: false, error: "Current model schema is unavailable", status: 500 };

  const policies = version.schema_json.permissions ?? [];
  if (policies.length === 0) return { allowed: true };

  const allowed = policies.some(
    (policy) => actor.roleKeys.includes(policy.role) && policy.operations.includes(operation),
  );
  return allowed
    ? { allowed: true }
    : { allowed: false, error: `This model does not grant your role the ${operation} operation`, status: 403 };
}

/** Resolves an entry inside the actor's workspace and applies its model policy. */
export async function canActorOperateEntry(
  actor: CmsActor,
  entryId: string,
  operation: ModelOperation,
): Promise<ModelAccessResult> {
  const entry = await getEntry(actor.workspaceId, entryId);
  if (!entry) return { allowed: false, error: "Entry not found", status: 404 };
  const model = await getModel(actor.workspaceId, entry.content_model_id);
  if (!model) return { allowed: false, error: "Model not found", status: 404 };
  return canActorOperateModel(actor, model, operation);
}
