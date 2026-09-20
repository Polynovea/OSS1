import { getModel, listModels, createModel, type ContentModelRow } from "@/lib/schema/modelService";
import { LANDING_PAGE_MODEL_SCHEMA, getDefaultStarterExperience } from "./constants";

export { LANDING_PAGE_MODEL_SCHEMA, getDefaultStarterExperience };

export async function ensureLandingPageModel(workspaceId: string, actorAdminUserId: string): Promise<ContentModelRow | null> {
  const models = await listModels(workspaceId);
  const existing = models.find((m) => m.api_key === "landing_page" || m.api_key === "page");
  if (existing && existing.status === "active") {
    return existing;
  }

  const created = await createModel({
    workspaceId,
    description: "Publishable modular pages composed with developer-approved blocks in Visual Experience Studio.",
    icon: "Sparkles",
    proposedSchema: LANDING_PAGE_MODEL_SCHEMA,
    createdBy: actorAdminUserId,
  });

  if (created.ok) {
    return created.data.model;
  }

  return null;
}
