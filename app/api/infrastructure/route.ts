import { requirePlatformAccess } from "@/lib/platform/permissions";
import type { PermissionKey } from "@/lib/platform/permissionCatalog";
import { listEnvironments } from "@/lib/infrastructure/environmentService";
import { applyEnvironmentSchema, bindWebsiteConnection, createWorkspaceBackup, ensureEnvironmentComponents, executeUpgrade, listOperabilityOverview, planEnvironmentSchema, planUpgrade, portabilityCheck, queueWebsiteTest, requestInfrastructureApproval, restoreBackup, reviewInfrastructureApproval, runComponentAction, runProvisioning, runSystemDoctor } from "@/lib/infrastructure/operabilityService";
import { backupLocalRuntime, initializeLocalRuntime, localRuntimeAction, restoreLocalRuntime } from "@/lib/infrastructure/localRuntime";

const response=(data:unknown,status=200)=>Response.json({success:status<400,data:status<400?data:null,error:status>=400?String(data):null,timestamp:new Date().toISOString()},{status});
const permissionFor=(op:string):PermissionKey=>({
  doctor:"infrastructure.diagnose",components:"deployment.manage",component_action:"deployment.manage",provision:"environment.provision",
  backup:"infrastructure.backup",restore:"infrastructure.restore",portability:"infrastructure.diagnose",upgrade_plan:"infrastructure.upgrade",upgrade_execute:"infrastructure.upgrade",
  website_bind:"website.manage",website_test:"website.manage",approval_request:"environment.manage",approval_review:"approval.review",
  local_init:"environment.provision",local_start:"environment.provision",local_stop:"environment.provision",local_status:"environment.read",local_upgrade:"infrastructure.upgrade",local_backup:"infrastructure.backup",local_restore:"infrastructure.restore",
  schema_plan:"schema.read",schema_apply:"schema.promote",
} as Record<string,PermissionKey>)[op]??"environment.read";

export async function GET(req:Request){
  const auth=await requirePlatformAccess(req,{permission:["environment.read","infrastructure.diagnose"]});if(auth.error)return auth.error;
  try{const url=new URL(req.url),environmentId=url.searchParams.get("environmentId")||undefined;const [environments,overview]=await Promise.all([listEnvironments(auth.data!.actor.workspaceId),listOperabilityOverview(auth.data!.actor.workspaceId,environmentId)]);return response({environments,overview,localRuntimeControl:process.env.POLYNOVEA_LOCAL_RUNTIME_CONTROL==="1"});}
  catch(error){return response(error instanceof Error?error.message:"Could not load infrastructure state",500);}
}

export async function POST(req:Request){
  let body:any;try{body=await req.json();}catch{return response("Request body must be JSON",400);}
  const operation=String(body.operation||"");const auth=await requirePlatformAccess(req,{permission:permissionFor(operation)});if(auth.error)return auth.error;
  const workspaceId=auth.data!.actor.workspaceId,actorId=auth.data!.actor.adminUserId;
  try{
    if(operation==="doctor")return response(await runSystemDoctor({workspaceId,environmentId:String(body.environmentId),actorId}));
    if(operation==="components")return response(await ensureEnvironmentComponents(workspaceId,String(body.environmentId)));
    if(operation==="component_action")return response(await runComponentAction({workspaceId,environmentId:String(body.environmentId),actorId,componentId:String(body.componentId),operation:body.componentOperation||"check",approvalRequestId:body.approvalRequestId||null}));
    if(operation==="provision")return response(await runProvisioning({workspaceId,environmentId:String(body.environmentId),actorId,providerKind:body.providerKind,operation:body.provisionOperation||"preflight",approvalRequestId:body.approvalRequestId||null}));
    if(operation==="backup")return response(await createWorkspaceBackup({workspaceId,environmentId:String(body.environmentId),actorId}));
    if(operation==="restore")return response(await restoreBackup({workspaceId,environmentId:String(body.environmentId),backupId:String(body.backupId),actorId,dryRun:Boolean(body.dryRun),approvalRequestId:body.approvalRequestId||null}));
    if(operation==="portability")return response(await portabilityCheck(workspaceId,String(body.environmentId)));
    if(operation==="upgrade_plan")return response(await planUpgrade({workspaceId,environmentId:String(body.environmentId),actorId,targetAppVersion:body.targetAppVersion||null,targetMigration:body.targetMigration||null}));
    if(operation==="upgrade_execute")return response(await executeUpgrade({workspaceId,environmentId:String(body.environmentId),actorId,upgradeRunId:String(body.upgradeRunId),backupId:body.backupId||null,approvalRequestId:body.approvalRequestId||null}));
    if(operation==="website_bind")return response(await bindWebsiteConnection({workspaceId,environmentId:String(body.environmentId),connectionId:String(body.connectionId),actorId,integrationMethod:body.integrationMethod,modelApiKeys:Array.isArray(body.modelApiKeys)?body.modelApiKeys:[],routeMapping:body.routeMapping??{}}));
    if(operation==="website_test")return response(await queueWebsiteTest({workspaceId,bindingId:String(body.bindingId),actorId}));
    if(operation==="approval_request")return response(await requestInfrastructureApproval({workspaceId,environmentId:body.environmentId||null,actorId,operation:String(body.approvalOperation),entityType:String(body.entityType),entityId:String(body.entityId),reason:String(body.reason||""),request:body.request??{}}));
    if(operation==="approval_review")return response(await reviewInfrastructureApproval({workspaceId,actorId,requestId:String(body.requestId),decision:body.decision,note:body.note||null}));
    if(operation==="local_init")return response(await initializeLocalRuntime(body.directory||null));
    if(operation==="local_start"||operation==="local_stop"||operation==="local_status"||operation==="local_upgrade")return response(await localRuntimeAction({action:operation.replace("local_","") as "start"|"stop"|"status"|"upgrade",directory:body.directory||null}));
    if(operation==="local_backup")return response(await backupLocalRuntime(body.directory||null));
    if(operation==="local_restore")return response(await restoreLocalRuntime({directory:body.directory||null,backupFile:String(body.backupFile)}));
    if(operation==="schema_plan")return response(await planEnvironmentSchema({workspaceId,environmentId:String(body.environmentId),modelId:String(body.modelId),proposedSchema:body.schema,actorId}));
    if(operation==="schema_apply")return response(await applyEnvironmentSchema({workspaceId,environmentId:String(body.environmentId),modelId:String(body.modelId),proposedSchema:body.schema,actorId,changeSummary:body.changeSummary||undefined,acknowledgeUnsafe:Boolean(body.acknowledgeUnsafe),approvalRequestId:body.approvalRequestId||null}));
    return response("Unsupported infrastructure operation",400);
  }catch(error:any){return response(error instanceof Error?error.message:"Infrastructure operation failed",Number(error?.status)||400);}
}
