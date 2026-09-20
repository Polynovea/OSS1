import { createServiceRoleClient } from "@/lib/admin/serviceRole";

async function rowsForWorkspace(table:string, workspaceId:string, select="*"){
  const {data,error}=await createServiceRoleClient().from(table).select(select).eq("workspace_id",workspaceId);
  if(error) throw new Error(`Export failed for ${table}: ${error.message}`);
  return data??[];
}
async function rowsByIds(table:string,column:string,ids:string[],select="*"){
  if(!ids.length)return [];
  const {data,error}=await createServiceRoleClient().from(table).select(select).in(column,ids);
  if(error) throw new Error(`Export failed for ${table}: ${error.message}`);
  return data??[];
}

/**
 * Portable, non-secret workspace export.
 *
 * The export intentionally includes canonical content/governance/history state
 * while excluding authentication credentials, API token material, encrypted
 * connector/destination configuration, webhook signing secrets, preview tokens
 * and raw delivery payloads. Those are environment/security state rather than
 * portable content and are handled by Phase 12.5 backup/secret-provider work.
 */
export async function exportWorkspaceData(workspaceId:string){
  const db=createServiceRoleClient();
  const [
    models,entries,assets,routes,redirects,taxonomies,menus,releases,workflowDefinitions,locales,quality,collections,translations,relations,
    uniqueValues,versionTerms,assignments,comments,watchers,savedViews,savedSearches,healthProfiles,healthFindings,remediationTasks,
    routeHistory,redirectHistory,replacementHistory,termAliases,termLocalizations,calendarEvents,notifications,releaseApprovals,
    releaseAssignments,releaseHistory,releaseRollback,analyticsStates,analyticsSnapshots,auditEvents,schemaRuns,importRuns,
    deliveryJobs,destinationHealth,publicationJobs,entities
  ]=await Promise.all([
    rowsForWorkspace("content_models",workspaceId),
    rowsForWorkspace("content_entries",workspaceId),
    rowsForWorkspace("assets",workspaceId,"id,workspace_id,storage_provider,storage_key,filename,mime_type,size_bytes,width,height,checksum,alt_text,caption,folder,metadata_json,created_by,created_at,archived_at"),
    rowsForWorkspace("content_routes",workspaceId),
    rowsForWorkspace("content_redirects",workspaceId),
    rowsForWorkspace("taxonomies",workspaceId),
    rowsForWorkspace("navigation_menus",workspaceId),
    rowsForWorkspace("releases",workspaceId),
    rowsForWorkspace("workflow_definitions",workspaceId),
    rowsForWorkspace("workspace_locales",workspaceId),
    rowsForWorkspace("web_quality_policies",workspaceId),
    rowsForWorkspace("media_collections",workspaceId),
    rowsForWorkspace("content_entry_translations",workspaceId),
    rowsForWorkspace("content_relations",workspaceId),
    rowsForWorkspace("content_entry_unique_values",workspaceId),
    rowsForWorkspace("content_entry_version_terms",workspaceId),
    rowsForWorkspace("content_assignments",workspaceId),
    rowsForWorkspace("content_comments",workspaceId),
    rowsForWorkspace("content_entry_watchers",workspaceId),
    rowsForWorkspace("content_entry_saved_views",workspaceId),
    rowsForWorkspace("content_saved_searches",workspaceId),
    rowsForWorkspace("content_health_profiles",workspaceId),
    rowsForWorkspace("content_health_findings",workspaceId),
    rowsForWorkspace("content_remediation_tasks",workspaceId),
    rowsForWorkspace("content_route_history",workspaceId),
    rowsForWorkspace("content_redirect_history",workspaceId),
    rowsForWorkspace("asset_replacement_history",workspaceId),
    rowsForWorkspace("taxonomy_term_aliases",workspaceId),
    rowsForWorkspace("taxonomy_term_localizations",workspaceId),
    rowsForWorkspace("editorial_calendar_events",workspaceId),
    rowsForWorkspace("editorial_notifications",workspaceId),
    rowsForWorkspace("release_approvals",workspaceId),
    rowsForWorkspace("release_assignments",workspaceId),
    rowsForWorkspace("release_history",workspaceId),
    rowsForWorkspace("release_rollback_items",workspaceId),
    rowsForWorkspace("analytics_sync_state",workspaceId),
    rowsForWorkspace("content_analytics_snapshots",workspaceId),
    rowsForWorkspace("platform_audit_events",workspaceId),
    rowsForWorkspace("developer_schema_runs",workspaceId),
    rowsForWorkspace("developer_import_runs",workspaceId),
    rowsForWorkspace("delivery_jobs",workspaceId,"id,workspace_id,kind,queue_name,status,priority,correlation_id,idempotency_key,safe_metadata_json,run_after,attempt_count,max_attempts,last_error_code,last_error_message,replay_of_job_id,created_by,created_at,updated_at,completed_at"),
    rowsForWorkspace("delivery_destination_health",workspaceId),
    rowsForWorkspace("publication_jobs",workspaceId,"id,workspace_id,target_id,entry_id,version_id,release_id,idempotency_key,status,attempt_count,max_attempts,next_attempt_at,started_at,completed_at,last_error,created_at,updated_at"),
    rowsForWorkspace("entities",workspaceId),
  ]);

  const modelIds=models.map((r:any)=>r.id);
  const entryIds=entries.map((r:any)=>r.id);
  const taxonomyIds=taxonomies.map((r:any)=>r.id);
  const menuIds=menus.map((r:any)=>r.id);
  const releaseIds=releases.map((r:any)=>r.id);
  const collectionIds=collections.map((r:any)=>r.id);
  const commentIds=comments.map((r:any)=>r.id);
  const deliveryJobIds=deliveryJobs.map((r:any)=>r.id);
  const publicationJobIds=publicationJobs.map((r:any)=>r.id);

  const [
    modelVersions,fields,entryVersions,terms,menuVersions,releaseItems,collectionAssets,commentMentions,deliveryAttempts,publicationLogs,
    workflowInstances,analyticsConnectorsSafe,publicationTargetsSafe,webhookSubscriptionsSafe
  ]=await Promise.all([
    rowsByIds("content_model_versions","content_model_id",modelIds),
    rowsByIds("content_fields","content_model_id",modelIds),
    rowsByIds("content_entry_versions","entry_id",entryIds),
    rowsByIds("taxonomy_terms","taxonomy_id",taxonomyIds),
    rowsByIds("navigation_menu_versions","menu_id",menuIds),
    rowsByIds("release_items","release_id",releaseIds),
    rowsByIds("media_collection_assets","collection_id",collectionIds),
    rowsByIds("content_comment_mentions","comment_id",commentIds),
    rowsByIds("delivery_job_attempts","job_id",deliveryJobIds),
    rowsByIds("publication_delivery_logs","job_id",publicationJobIds),
    rowsByIds("workflow_instances","entry_id",entryIds),
    rowsForWorkspace("analytics_connectors",workspaceId,"id,workspace_id,provider,name,credential_mode,active,created_by,created_at,updated_at"),
    rowsForWorkspace("publication_targets",workspaceId,"id,workspace_id,name,target_type,active,created_by,created_at,updated_at"),
    rowsForWorkspace("webhook_subscriptions",workspaceId,"id,workspace_id,name,endpoint_url,event_filters,active,consecutive_failures,created_by,created_at,updated_at"),
  ]);
  const workflowInstanceIds=workflowInstances.map((r:any)=>r.id);
  const [workflowActions,workflowStageApprovals]=await Promise.all([
    rowsByIds("workflow_actions","workflow_instance_id",workflowInstanceIds),
    rowsByIds("workflow_stage_approvals","workflow_instance_id",workflowInstanceIds),
  ]);

  const {data:workspace,error:workspaceError}=await db.from("workspaces").select("id,slug,name,created_at,updated_at").eq("id",workspaceId).maybeSingle();
  if(workspaceError)throw new Error(workspaceError.message);

  return {
    format:"polynovea-cms-export",
    formatVersion:2,
    exportedAt:new Date().toISOString(),
    workspace,
    schema:{models,modelVersions,fields},
    content:{entries,entryVersions,uniqueValues,versionTerms,relations,translations},
    collaboration:{assignments,comments,commentMentions,watchers,savedViews},
    discovery:{savedSearches},
    health:{profiles:healthProfiles,findings:healthFindings,remediationTasks},
    media:{assets,collections,collectionAssets,replacementHistory},
    routing:{routes,redirects,routeHistory,redirectHistory},
    taxonomy:{taxonomies,terms,aliases:termAliases,localizations:termLocalizations},
    navigation:{menus,menuVersions},
    workflow:{definitions:workflowDefinitions,instances:workflowInstances,actions:workflowActions,stageApprovals:workflowStageApprovals},
    releases:{releases,items:releaseItems,approvals:releaseApprovals,assignments:releaseAssignments,history:releaseHistory,rollbackItems:releaseRollback,locales},
    editorial:{calendarEvents,notifications},
    analytics:{connectors:analyticsConnectorsSafe,syncState:analyticsStates,snapshots:analyticsSnapshots},
    delivery:{jobs:deliveryJobs,attempts:deliveryAttempts,destinationHealth,publicationTargets:publicationTargetsSafe,publicationJobs,publicationLogs,webhookSubscriptions:webhookSubscriptionsSafe},
    developer:{schemaRuns,importRuns},
    platform:{entities,auditEvents,webQualityPolicies:quality},
    securityNote:"Portable export intentionally excludes admin/auth credentials, workspace membership credentials, API tokens and hashes, encrypted publication/analytics connector configuration, webhook signing secrets, preview tokens, and raw delivery payloads. Phase 12.5 backup/restore and secret-provider workflows handle environment/security recovery separately.",
  };
}
