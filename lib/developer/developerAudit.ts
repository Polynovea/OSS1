import { logPlatformEvent } from "@/lib/platform/audit";
import type { DeveloperApiContext } from "@/lib/developer/apiAuth";
import { recordBoundAgentMutation } from "@/lib/developer/agentGovernanceService";

export async function logDeveloperApiMutation(
  context: DeveloperApiContext,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  if (!context.actorAdminUserId) return;
  await logPlatformEvent({
    workspaceId: context.workspaceId,
    actorAdminUserId: context.actorAdminUserId,
    action,
    entityType,
    entityId: entityId ?? undefined,
    metadata: {
      ...metadata,
      developerApiTokenId: context.tokenId,
      developerApiTokenName: context.tokenName,
      requestId: context.requestId,
      actorType: "developer_api_token",
    },
  });
  // This runs only after the ordinary governed route has completed its domain
  // mutation successfully. MCP clients cannot fabricate this final state.
  if (context.agentIdentityId && context.agentToolName) {
    await recordBoundAgentMutation({
      context,
      toolName: context.agentToolName,
      changedFields: Object.keys(metadata).filter((key) => !/token|secret|credential/i.test(key)),
      safeInputSummary: { action, entityType, entityId, metadataKeys: Object.keys(metadata).sort() },
      afterJson: { entityId, action },
    });
  }
}
