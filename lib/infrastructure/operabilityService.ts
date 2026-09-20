import { createHash, randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { exportWorkspaceData } from "@/lib/developer/exportService";
import { getConnection } from "@/lib/infrastructure/connectionService";
import { resolveConnectionCredentials } from "@/lib/infrastructure/credentialProvider";
import { enqueueDeliveryJob } from "@/lib/operations/deliveryJobService";
import { createPublicationTarget } from "@/lib/content/publicationService";
import { getModel, getVersion } from "@/lib/schema/modelService";
import { dryRunSchemaPromotion, modelBundle, promoteSchemaBundle, type SchemaBundle } from "@/lib/developer/schemaDeliveryService";
import { logPlatformEvent } from "@/lib/platform/audit";
import { runDatabaseProvisioning } from "@/lib/infrastructure/databaseProvisioning";
import { deploySupabaseEdgeFunctions, discoverPackagedSupabaseEdgeFunctions, edgeFunctionManifestsFromComponent, inspectSupabaseEdgeRuntime } from "@/lib/infrastructure/supabaseManagement";

const canonicalJson=(value:unknown):string=>{if(value===null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;const obj=value as Record<string,unknown>;return `{${Object.keys(obj).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(obj[key])}`).join(",")}}`;};

const REQUIRED_COMPONENTS = [
  { capabilityKey: "postgres", componentKey: "postgres", required: true },
  { capabilityKey: "durable_worker", componentKey: "delivery-worker", required: true },
  { capabilityKey: "secret_store", componentKey: "secret-store", required: true },
  { capabilityKey: "scheduled_execution", componentKey: "scheduler", required: true },
  { capabilityKey: "public_http", componentKey: "cms-http", required: true },
  { capabilityKey: "object_storage", componentKey: "object-storage", required: false },
  { capabilityKey: "edge_runtime", componentKey: "edge-runtime", required: false },
] as const;

async function resolveApprovedInfrastructureRequest(params:{workspaceId:string;environmentId?:string|null;operation:string;entityId:string;approvalRequestId?:string|null}){
  const db=createServiceRoleClient();let query=db.from("infrastructure_approval_requests").select("id,status,expires_at").eq("workspace_id",params.workspaceId).eq("operation",params.operation).eq("entity_id",params.entityId).eq("status","approved");if(params.environmentId)query=query.eq("environment_id",params.environmentId);if(params.approvalRequestId)query=query.eq("id",params.approvalRequestId);const {data}=await query.order("reviewed_at",{ascending:false}).limit(10);return (data??[]).find(item=>!item.expires_at||new Date(item.expires_at)>new Date())?.id??null;
}
async function markInfrastructureApprovalExecuted(workspaceId:string,requestId:string|null|undefined){if(!requestId)return;await createServiceRoleClient().from("infrastructure_approval_requests").update({status:"executed",executed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("workspace_id",workspaceId).eq("id",requestId).eq("status","approved");}

export async function ensureEnvironmentComponents(workspaceId:string,environmentId:string){
  const db=createServiceRoleClient();
  const {data:env}=await db.from("workspace_environments").select("id,database_provider,storage_provider,runtime_provider,secret_provider_id").eq("workspace_id",workspaceId).eq("id",environmentId).maybeSingle();
  if(!env)throw Object.assign(new Error("Environment not found"),{status:404});
  const [{data:connections},{data:secretProvider},{data:existing}]=await Promise.all([
    db.from("workspace_connections").select("id,connector_type,connector_family,status,active,last_verified_at,last_success_at").eq("workspace_id",workspaceId).eq("environment_id",environmentId),
    env.secret_provider_id?db.from("workspace_secret_providers").select("id,provider_kind,status").eq("workspace_id",workspaceId).eq("environment_id",environmentId).eq("id",env.secret_provider_id).maybeSingle():Promise.resolve({data:null}),
    db.from("environment_components").select("id,capability_key,component_key,provider,state,metadata_json,last_checked_at").eq("workspace_id",workspaceId).eq("environment_id",environmentId),
  ]);
  const active=(connections??[]).filter(c=>c.active&&c.status==="active");const databaseConnection=active.find(c=>c.connector_family==="database")??null;const storageConnection=active.find(c=>c.connector_family==="storage")??null;
  const legacyR2=Boolean(process.env.R2_ACCESS_KEY_ID&&process.env.R2_SECRET_ACCESS_KEY&&(process.env.R2_ACCOUNT_ID||process.env.R2_S3_ENDPOINT));
  const runtimeProvider=env.runtime_provider??null;const edgeProvider=runtimeProvider&&/(supabase|edge|deno)/i.test(runtimeProvider)?runtimeProvider:null;
  const secretReady=Boolean(secretProvider&&secretProvider.status==="active"&&(secretProvider.provider_kind!=="encrypted_postgres"||process.env.CMS_CONFIG_ENCRYPTION_KEY));
  const localRuntime=String(runtimeProvider||"").toLowerCase().includes("local");
  const providerByCapability:Record<string,string|null>={
    postgres:databaseConnection?.connector_type??(localRuntime?"local-postgres":null),
    durable_worker:runtimeProvider??null,
    secret_store:secretReady?String(secretProvider?.provider_kind||"configured"):null,
    scheduled_execution:runtimeProvider??null,
    public_http:runtimeProvider??null,
    object_storage:storageConnection?.connector_type??(legacyR2?"legacy-r2":null),
    edge_runtime:edgeProvider,
  };
  const existingByKey=new Map((existing??[]).map(row=>[row.component_key,row]));
  for(const item of REQUIRED_COMPONENTS){
    const provider=providerByCapability[item.capabilityKey]??null;
    const previous=existingByKey.get(item.componentKey);let inferredState:string;
    if(item.capabilityKey==="edge_runtime")inferredState=provider?(previous&&previous.provider===provider&&["present","degraded","outdated","failed"].includes(previous.state)?previous.state:"missing"):"unsupported";
    else if(item.capabilityKey==="object_storage")inferredState=provider?"present":"unsupported";
    else if(item.capabilityKey==="secret_store")inferredState=secretReady?"present":"missing";
    else inferredState=provider?(previous&&["degraded","outdated","failed"].includes(previous.state)?previous.state:"present"):item.required?"missing":"unsupported";
    const metadata={...(previous?.metadata_json??{}),source:item.capabilityKey==="postgres"&&databaseConnection?"verified_connection":item.capabilityKey==="object_storage"&&storageConnection?"verified_connection":item.capabilityKey==="secret_store"?"secret_provider":"environment",connectionId:item.capabilityKey==="postgres"?databaseConnection?.id??null:item.capabilityKey==="object_storage"?storageConnection?.id??null:null,lastCapabilityResolutionAt:new Date().toISOString()};
    await db.from("environment_components").upsert({workspace_id:workspaceId,environment_id:environmentId,capability_key:item.capabilityKey,component_key:item.componentKey,required:item.required,provider,state:inferredState,metadata_json:metadata,last_checked_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"environment_id,component_key"});
  }
  const {data}=await db.from("environment_components").select("*").eq("workspace_id",workspaceId).eq("environment_id",environmentId).order("required",{ascending:false});
  return data??[];
}

export async function runSystemDoctor(params:{workspaceId:string;environmentId:string;actorId:string}){
  const db=createServiceRoleClient();
  const [{data:env},{data:connections},{data:jobs},{data:sync},{data:runtime}]=await Promise.all([
    db.from("workspace_environments").select("*").eq("workspace_id",params.workspaceId).eq("id",params.environmentId).maybeSingle(),
    db.from("workspace_connections").select("id,name,connector_type,status,last_error_code,last_error_message,last_verified_at").eq("workspace_id",params.workspaceId).eq("environment_id",params.environmentId),
    db.from("delivery_jobs").select("id,status,kind,updated_at,last_error_code,last_error_message").eq("workspace_id",params.workspaceId).order("updated_at",{ascending:false}).limit(50),
    db.from("analytics_sync_state").select("status,fresh_through,last_success_at,last_error").eq("workspace_id",params.workspaceId),
    db.from("cms_runtime_state").select("schema_migration,app_version,worker_version").eq("singleton",true).maybeSingle(),
  ]);
  if(!env)throw Object.assign(new Error("Environment not found"),{status:404});
  const {data:secretProvider}=env.secret_provider_id?await db.from("workspace_secret_providers").select("provider_kind,status").eq("workspace_id",params.workspaceId).eq("id",env.secret_provider_id).maybeSingle():{data:null};
  const components=await ensureEnvironmentComponents(params.workspaceId,params.environmentId);
  const findings:Array<Record<string,unknown>>=[];
  const add=(key:string,severity:"info"|"warning"|"blocking",message:string,owner:string,repairHref:string,evidence:Record<string,unknown>={})=>findings.push({key,severity,message,owner,repairHref,evidence});
  add("database.reachable","info","CMS database connection is operational.","database","/admin/environments",{migration:runtime?.schema_migration??null});
  if(["postgres","supabase"].includes(String(env.database_provider||"").toLowerCase())){
    const database=await runDatabaseProvisioning({workspaceId:params.workspaceId,environmentId:params.environmentId,operation:"verify"});
    for(const check of database.checks){
      if(check.status==="failed")add(`target.${check.key}`,"blocking",check.message,"database","/admin/infrastructure",check.evidence??{});
      else if(check.status==="warning")add(`target.${check.key}`,"warning",check.message,"database","/admin/infrastructure",check.evidence??{});
    }
  }
  if(env.kind!=="local"&&env.cms_base_url&&String(env.cms_base_url).startsWith("http://"))add("http.insecure","blocking","Non-local CMS URL uses HTTP instead of HTTPS.","environment","/admin/environments",{url:env.cms_base_url});
  if(secretProvider?.provider_kind==="encrypted_postgres"&&!process.env.CMS_CONFIG_ENCRYPTION_KEY)add("secret.encryption_key","blocking","This environment uses encrypted PostgreSQL credentials but CMS_CONFIG_ENCRYPTION_KEY is not configured.","secret_store","/admin/environments");
  for(const component of components??[]){if(component.required&&component.state!=="present")add(`component.${component.component_key}`,"blocking",`Required component ${component.component_key} is ${component.state}.`,"deployment","/admin/infrastructure",{provider:component.provider,state:component.state});}
  for(const connection of connections??[]){if(["failed","degraded"].includes(connection.status))add(`connection.${connection.id}`,connection.status==="failed"?"blocking":"warning",`${connection.name} is ${connection.status}${connection.last_error_message?`: ${connection.last_error_message}`:""}.`,"connections","/admin/connections",{connectorType:connection.connector_type});else if(connection.status!=="active")add(`connection.${connection.id}`,"warning",`${connection.name} has not been verified active.`,"connections","/admin/connections",{status:connection.status});}
  const recentFailed=(jobs??[]).filter(j=>["failed","dead_letter"].includes(j.status));if(recentFailed.length)add("delivery.failures","warning",`${recentFailed.length} recent durable delivery job(s) need attention.`,"delivery","/admin/operations",{count:recentFailed.length});
  for(const state of sync??[]){if(["failed","stale"].includes(state.status))add("analytics.freshness","warning",`Analytics synchronization is ${state.status}.`,"analytics","/admin/intelligence",{freshThrough:state.fresh_through});}
  const schemaRows=await db.from("environment_schema_deployments").select("content_model_id,schema_version,schema_hash,status").eq("workspace_id",params.workspaceId).eq("environment_id",params.environmentId).order("deployed_at",{ascending:false});
  const deployedByModel=new Map<string,any>();for(const row of schemaRows.data??[])if(!deployedByModel.has(row.content_model_id))deployedByModel.set(row.content_model_id,row);
  const models=await db.from("content_models").select("id,api_key,current_schema_version").eq("workspace_id",params.workspaceId).eq("status","active");
  for(const model of models.data??[]){const deployed=deployedByModel.get(model.id);if(!deployed)add(`schema.${model.id}`,"warning",`Model ${model.api_key} has no recorded deployment for this environment.`,"schema","/admin/models",{currentVersion:model.current_schema_version});else if(deployed.schema_version!==model.current_schema_version)add(`schema.${model.id}`,"warning",`Model ${model.api_key} is deployed at v${deployed.schema_version} while canonical is v${model.current_schema_version}.`,"schema","/admin/models",{deployedVersion:deployed.schema_version,currentVersion:model.current_schema_version});}
  const blocking=findings.filter(f=>f.severity==="blocking").length,warnings=findings.filter(f=>f.severity==="warning").length;
  const status=blocking?"blocked":warnings?"warning":"healthy";
  const correlationId=randomUUID();
  const {data:run,error}=await db.from("system_doctor_runs").insert({workspace_id:params.workspaceId,environment_id:params.environmentId,status,correlation_id:correlationId,findings_json:findings,summary_json:{blocking,warnings,total:findings.length},checked_by:params.actorId}).select().single();
  if(error||!run)throw new Error(error?.message||"Could not record System Doctor run");
  await db.from("workspace_environments").update({status:blocking?"blocked":warnings?"degraded":"ready",health_json:{status,blocking,warnings,total:findings.length,lastRunId:run.id},last_health_check_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("workspace_id",params.workspaceId).eq("id",params.environmentId);
  await logPlatformEvent({workspaceId:params.workspaceId,actorAdminUserId:params.actorId,action:"infrastructure.doctor.ran",entityType:"workspace_environment",entityId:params.environmentId,metadata:{correlationId,status,blocking,warnings}});
  return run;
}

export async function listOperabilityOverview(workspaceId:string,environmentId?:string){
  const db=createServiceRoleClient();const envFilter=(q:any)=>environmentId?q.eq("environment_id",environmentId):q;
  const [doctor,provisioning,components,backups,upgrades,approvals,websites]=await Promise.all([
    envFilter(db.from("system_doctor_runs").select("*").eq("workspace_id",workspaceId)).order("checked_at",{ascending:false}).limit(20),
    envFilter(db.from("environment_provisioning_runs").select("*").eq("workspace_id",workspaceId)).order("created_at",{ascending:false}).limit(50),
    envFilter(db.from("environment_components").select("*").eq("workspace_id",workspaceId)).order("component_key"),
    envFilter(db.from("workspace_backups").select("id,environment_id,backup_kind,status,format_version,checksum_sha256,size_bytes,storage_locator,created_at,verified_at,restored_at").eq("workspace_id",workspaceId)).order("created_at",{ascending:false}).limit(50),
    envFilter(db.from("environment_upgrade_runs").select("*").eq("workspace_id",workspaceId)).order("created_at",{ascending:false}).limit(50),
    envFilter(db.from("infrastructure_approval_requests").select("*").eq("workspace_id",workspaceId)).order("created_at",{ascending:false}).limit(100),
    envFilter(db.from("website_connection_bindings").select("*").eq("workspace_id",workspaceId)).order("created_at",{ascending:false}).limit(50),
  ]);
  return {doctorRuns:doctor.data??[],provisioningRuns:provisioning.data??[],components:components.data??[],backups:backups.data??[],upgrades:upgrades.data??[],approvals:approvals.data??[],websites:websites.data??[]};
}

export async function runProvisioning(params:{workspaceId:string;environmentId:string;actorId:string;providerKind:"managed"|"postgres"|"supabase"|"local";operation:"preflight"|"initialize"|"upgrade"|"verify"|"repair";approvalRequestId?:string|null}){
  const db=createServiceRoleClient();const idempotencyKey=`${params.environmentId}:${params.providerKind}:${params.operation}:${new Date().toISOString().slice(0,13)}`;
  const {data:existing}=await db.from("environment_provisioning_runs").select("*").eq("workspace_id",params.workspaceId).eq("idempotency_key",idempotencyKey).maybeSingle();if(existing)return existing;
  const {data:environment}=await db.from("workspace_environments").select("id,kind").eq("workspace_id",params.workspaceId).eq("id",params.environmentId).maybeSingle();if(!environment)throw Object.assign(new Error("Environment not found"),{status:404});
  let approvalRequestId=params.approvalRequestId??null;
  if(environment.kind==="production"&&["initialize","upgrade","repair"].includes(params.operation)){
    approvalRequestId=await resolveApprovedInfrastructureRequest({workspaceId:params.workspaceId,environmentId:params.environmentId,operation:"provision",entityId:params.environmentId,approvalRequestId});
    if(!approvalRequestId)throw Object.assign(new Error("Production provisioning change requires approval."),{status:409,requiresApproval:true});
  }
  const {data:run,error}=await db.from("environment_provisioning_runs").insert({workspace_id:params.workspaceId,environment_id:params.environmentId,provider_kind:params.providerKind,operation:params.operation,status:"running",idempotency_key:idempotencyKey,started_at:new Date().toISOString(),created_by:params.actorId,safe_input_json:{providerKind:params.providerKind,operation:params.operation}}).select().single();if(error||!run)throw new Error(error?.message||"Could not start provisioning run");
  try{
    const components=await ensureEnvironmentComponents(params.workspaceId,params.environmentId);
    let checks:Array<Record<string,unknown>>=[],result:Record<string,unknown>={};let blocked=false,ready=false;
    if(params.providerKind==="postgres"||params.providerKind==="supabase"){
      const database=await runDatabaseProvisioning({workspaceId:params.workspaceId,environmentId:params.environmentId,operation:params.operation});
      checks=database.checks.map(check=>({...check}));result={database,migrations:database.migration,components:components.map(c=>({key:c.component_key,state:c.state,provider:c.provider}))};blocked=!database.supported||database.checks.some(c=>c.status==="failed");ready=database.ready&&!components.some(c=>c.required&&c.state!=="present");
      if(database.ready){const postgres=components.find(c=>c.component_key==="postgres");if(postgres)await db.from("environment_components").update({state:"present",last_checked_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq("id",postgres.id);}
    }else{
      checks=[{key:"database",status:"passed",message:"Current CMS database session is operational."},{key:"components",status:components.some(c=>c.required&&c.state!=="present")?"warning":"passed",message:`${components.length} capability records evaluated.`}];
      if(params.providerKind==="managed")checks.push({key:"managed",status:"warning",message:"Managed provisioning is provider-adapter dependent. Configure the hosting/database connection and run Verify; unsupported automation remains explicit."});
      if(params.providerKind==="local")checks.push({key:"local_runtime",status:"passed",message:"Local runtime package is available. Use Local Workspace Initialize/Start, then Verify this environment."});
      blocked=components.some(c=>c.required&&c.state==="missing");ready=!blocked&&params.operation==="verify";result={components:components.map(c=>({key:c.component_key,state:c.state,provider:c.provider}))};
    }
    const status=blocked?"blocked":"succeeded";
    const {data:done}=await db.from("environment_provisioning_runs").update({status,checks_json:checks,result_json:result,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",run.id).select().single();
    await db.from("workspace_environments").update({status:blocked?"blocked":ready?"ready":"provisioning",updated_at:new Date().toISOString()}).eq("workspace_id",params.workspaceId).eq("id",params.environmentId);
    if(status==="succeeded")await markInfrastructureApprovalExecuted(params.workspaceId,approvalRequestId);
    await logPlatformEvent({workspaceId:params.workspaceId,actorAdminUserId:params.actorId,action:"infrastructure.provisioning.completed",entityType:"workspace_environment",entityId:params.environmentId,metadata:{runId:run.id,providerKind:params.providerKind,operation:params.operation,status,ready}});
    return done;
  }catch(error){const message=error instanceof Error?error.message:"Provisioning failed";await db.from("environment_provisioning_runs").update({status:"failed",last_error_code:"PROVISIONING_FAILED",last_error_message:message,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",run.id);await db.from("workspace_environments").update({status:"blocked",updated_at:new Date().toISOString()}).eq("workspace_id",params.workspaceId).eq("id",params.environmentId);throw error;}
}

export async function planEnvironmentSchema(params:{workspaceId:string;environmentId:string;modelId:string;proposedSchema:unknown;actorId?:string}){
  const model=await getModel(params.workspaceId,params.modelId);if(!model)throw Object.assign(new Error("Model not found"),{status:404});
  const current=await modelBundle(params.workspaceId,model);const proposed:SchemaBundle={...current,environment:params.environmentId,generatedAt:new Date().toISOString(),models:current.models.map(item=>item.apiKey===model.api_key?{...item,schema:params.proposedSchema as any}:item)};
  const context={workspaceId:params.workspaceId,actorAdminUserId:params.actorId??null,tokenId:null,tokenName:"admin-ui"};
  const plan=await dryRunSchemaPromotion(context,proposed,params.environmentId);
  const item=plan.items.find(entry=>entry.apiKey===model.api_key);const db=createServiceRoleClient();const {data:currentDeployment}=await db.from("environment_schema_deployments").select("schema_version,schema_hash,status,deployed_at").eq("workspace_id",params.workspaceId).eq("environment_id",params.environmentId).eq("content_model_id",params.modelId).order("deployed_at",{ascending:false}).limit(1).maybeSingle();
  return {model:{id:model.id,apiKey:model.api_key,currentVersion:model.current_schema_version},environmentId:params.environmentId,diff:item?.diff??null,currentDeployment,classification:item?.classification??plan.overallClassification,requiresApproval:(item?.classification??plan.overallClassification)!=="SAFE",runId:plan.runId,rollbackGuidance:item?.rollbackGuidance};
}

export async function applyEnvironmentSchema(params:{workspaceId:string;environmentId:string;modelId:string;proposedSchema:unknown;actorId:string;changeSummary?:string;acknowledgeUnsafe:boolean;approvalRequestId?:string|null}){
  const model=await getModel(params.workspaceId,params.modelId);if(!model)throw Object.assign(new Error("Model not found"),{status:404});const db=createServiceRoleClient();const {data:env}=await db.from("workspace_environments").select("id,key,kind").eq("workspace_id",params.workspaceId).eq("id",params.environmentId).maybeSingle();if(!env)throw Object.assign(new Error("Environment not found"),{status:404});
  const current=await modelBundle(params.workspaceId,model);const proposed:SchemaBundle={...current,environment:env.key,generatedAt:new Date().toISOString(),models:current.models.map(item=>item.apiKey===model.api_key?{...item,schema:params.proposedSchema as any}:item)};const pre=await dryRunSchemaPromotion({workspaceId:params.workspaceId,actorAdminUserId:params.actorId,tokenId:null,tokenName:"admin-ui"},proposed,env.key);const item=pre.items.find(entry=>entry.apiKey===model.api_key);const unsafe=(item?.classification??pre.overallClassification)!=="SAFE";
  if(unsafe&&env.kind==="production"){let approvalRequestId=params.approvalRequestId??null;if(!approvalRequestId){const {data:auto}=await db.from("infrastructure_approval_requests").select("id").eq("workspace_id",params.workspaceId).eq("environment_id",params.environmentId).eq("operation","schema_promote").eq("entity_id",params.modelId).eq("status","approved").order("reviewed_at",{ascending:false}).limit(1).maybeSingle();approvalRequestId=auto?.id??null;}if(!approvalRequestId)throw Object.assign(new Error("Production unsafe schema promotion requires approval. Request it from the migration preview."),{status:409,requiresApproval:true});const {data:approval}=await db.from("infrastructure_approval_requests").select("id,status,operation,entity_id,expires_at").eq("workspace_id",params.workspaceId).eq("id",approvalRequestId).maybeSingle();if(!approval||approval.status!=="approved"||approval.operation!=="schema_promote"||approval.entity_id!==params.modelId||(approval.expires_at&&new Date(approval.expires_at)<=new Date()))throw Object.assign(new Error("Valid schema promotion approval not found"),{status:409});params.approvalRequestId=approvalRequestId;}
  const result=await promoteSchemaBundle({context:{workspaceId:params.workspaceId,actorAdminUserId:params.actorId,tokenId:null,tokenName:"admin-ui"},bundle:proposed,acknowledgeUnsafe:params.acknowledgeUnsafe,approvalNote:unsafe?(params.changeSummary||"Approved visual schema promotion"):params.changeSummary||null,targetEnvironment:env.key,operation:"promotion"});if(!result.applied&&result.blocked)throw Object.assign(new Error(("reason" in result&&typeof result.reason==="string"?result.reason:null)||"Schema promotion blocked"),{status:409});if(!result.applied)throw Object.assign(new Error("Schema promotion failed"),{status:500});
  const refreshed=await getModel(params.workspaceId,params.modelId);if(!refreshed)throw new Error("Model disappeared after schema promotion");const version=await getVersion(refreshed.id,refreshed.current_schema_version);if(!version)throw new Error("Promoted schema version not found");
  await db.from("environment_schema_deployments").insert({workspace_id:params.workspaceId,environment_id:params.environmentId,content_model_id:params.modelId,schema_version:refreshed.current_schema_version,schema_hash:version.schema_hash,status:"deployed",developer_schema_run_id:result.runId,deployed_by:params.actorId,metadata_json:{classification:item?.classification??result.overallClassification,channel:"visual_builder"}});await db.from("workspace_environments").update({deployed_schema_hash:version.schema_hash,deployed_schema_revision:`${refreshed.api_key}:v${refreshed.current_schema_version}`,updated_at:new Date().toISOString()}).eq("workspace_id",params.workspaceId).eq("id",params.environmentId);if(params.approvalRequestId)await db.from("infrastructure_approval_requests").update({status:"executed",executed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("workspace_id",params.workspaceId).eq("id",params.approvalRequestId).eq("status","approved");return {promotion:result,environmentId:params.environmentId,schemaVersion:refreshed.current_schema_version,schemaHash:version.schema_hash,classification:item?.classification??result.overallClassification};
}

export async function createWorkspaceBackup(params:{workspaceId:string;environmentId:string;actorId:string}){
  const db=createServiceRoleClient();const payload=await exportWorkspaceData(params.workspaceId);const serialized=canonicalJson(payload);const checksum=createHash("sha256").update(serialized).digest("hex");
  const connectionRows=await db.from("workspace_connections").select("id,environment_id,connector_type,connector_family,name,status,active,config_json,metadata_json,legacy_resource_type,legacy_resource_id,created_at,updated_at").eq("workspace_id",params.workspaceId);
  const environments=await db.from("workspace_environments").select("id,key,name,kind,status,is_default,cms_base_url,public_site_urls,database_provider,storage_provider,runtime_provider,deployed_schema_hash,deployed_schema_revision,config_json,created_at,updated_at").eq("workspace_id",params.workspaceId);
  const manifest={format:"polynovea-cms-backup",formatVersion:1,createdAt:new Date().toISOString(),workspaceId:params.workspaceId,environmentId:params.environmentId,portableExportFormatVersion:(payload as any).formatVersion,connections:connectionRows.data??[],environments:environments.data??[],security:"No credential values, API tokens, hashes or encrypted secret payloads are included."};
  const {data,error}=await db.from("workspace_backups").insert({workspace_id:params.workspaceId,environment_id:params.environmentId,status:"verified",format_version:1,checksum_sha256:checksum,manifest_json:manifest,payload_json:payload,size_bytes:Buffer.byteLength(serialized),created_by:params.actorId,verified_at:new Date().toISOString()}).select("id,environment_id,status,format_version,checksum_sha256,manifest_json,size_bytes,created_at,verified_at").single();if(error||!data)throw new Error(error?.message||"Could not create backup");
  await logPlatformEvent({workspaceId:params.workspaceId,actorAdminUserId:params.actorId,action:"infrastructure.backup.created",entityType:"workspace_backup",entityId:data.id,metadata:{environmentId:params.environmentId,checksum,sizeBytes:Buffer.byteLength(serialized)}});return data;
}

export async function restoreBackup(params:{workspaceId:string;environmentId:string;backupId:string;actorId:string;dryRun:boolean;approvalRequestId?:string|null}){
  const db=createServiceRoleClient();const {data:backup}=await db.from("workspace_backups").select("*").eq("workspace_id",params.workspaceId).eq("id",params.backupId).maybeSingle();if(!backup)throw Object.assign(new Error("Backup not found"),{status:404});
  const serialized=canonicalJson(backup.payload_json??{});const checksum=createHash("sha256").update(serialized).digest("hex");const compatible=checksum===backup.checksum_sha256&&backup.manifest_json?.format==="polynovea-cms-backup";
  const compatibility={checksumMatches:checksum===backup.checksum_sha256,format:backup.manifest_json?.format??null,formatVersion:backup.format_version,targetEnvironmentId:params.environmentId,canRestore:compatible,mode:params.dryRun?"dry_run":"restore",note:"Portable data restore is safe only into the same workspace identity. Provider/runtime disaster recovery uses the local/runtime adapter or provider-native database recovery."};
  if(params.dryRun){const {data}=await db.from("workspace_restore_runs").insert({workspace_id:params.workspaceId,environment_id:params.environmentId,backup_id:params.backupId,mode:"dry_run",status:compatible?"planned":"blocked",compatibility_json:compatibility,created_by:params.actorId,completed_at:new Date().toISOString()}).select().single();return data;}
  if(!compatible)throw Object.assign(new Error("Backup compatibility check failed"),{status:409});
  const approvalRequestId=await resolveApprovedInfrastructureRequest({workspaceId:params.workspaceId,environmentId:params.environmentId,operation:"restore",entityId:params.backupId,approvalRequestId:params.approvalRequestId});if(!approvalRequestId)throw Object.assign(new Error("Restore-over-existing requires an approved infrastructure request"),{status:409,requiresApproval:true});
  const {data:targetEnv}=await db.from("workspace_environments").select("id,kind,database_provider,runtime_provider").eq("workspace_id",params.workspaceId).eq("id",params.environmentId).maybeSingle();
  const guidance=targetEnv?.kind==="local"?"Use Local Workspace restore with the verified SQL backup. It performs the provider-level PostgreSQL restore and preserves full CMS semantics.":"This environment does not have an automatic database-restore adapter configured. Use the provider recovery path generated for this environment, then rerun System Doctor. Polynovea will not report a metadata-only restore as success.";
  const {data:run,error:runError}=await db.from("workspace_restore_runs").insert({workspace_id:params.workspaceId,environment_id:params.environmentId,backup_id:params.backupId,mode:"restore",status:"blocked",compatibility_json:{...compatibility,providerRecoveryRequired:true},result_json:{restored:false,reason:"provider_restore_required",guidance,databaseProvider:targetEnv?.database_provider??null,runtimeProvider:targetEnv?.runtime_provider??null},approval_request_id:approvalRequestId,created_by:params.actorId,completed_at:new Date().toISOString()}).select().single();if(runError||!run)throw new Error(runError?.message||"Could not record blocked restore");return run;
}

export async function portabilityCheck(workspaceId:string,environmentId:string){
  const db=createServiceRoleClient();const [{data:connections},{data:components},{data:refs},{data:assets}]=await Promise.all([
    db.from("workspace_connections").select("id,name,connector_type,connector_family,status,legacy_resource_type").eq("workspace_id",workspaceId).eq("environment_id",environmentId),
    db.from("environment_components").select("component_key,provider,state,required").eq("workspace_id",workspaceId).eq("environment_id",environmentId),
    db.from("workspace_secret_refs").select("id,state,provider_id").eq("workspace_id",workspaceId).eq("environment_id",environmentId),
    db.from("assets").select("id,storage_provider,storage_key,archived_at").eq("workspace_id",workspaceId),
  ]);
  const blockers:Array<Record<string,unknown>>=[],warnings:Array<Record<string,unknown>>=[];
  for(const ref of refs??[])if(["missing","inaccessible","revoked","expired"].includes(ref.state))blockers.push({type:"secret_reference",id:ref.id,state:ref.state});
  for(const c of components??[])if(c.required&&["unsupported","missing","failed"].includes(c.state))blockers.push({type:"component",component:c.component_key,state:c.state,provider:c.provider});
  for(const c of connections??[])if(c.status!=="active")warnings.push({type:"connection",name:c.name,connectorType:c.connector_type,status:c.status});
  for(const asset of assets??[])if(!asset.archived_at&&!asset.storage_key)blockers.push({type:"asset",id:asset.id,reason:"missing_storage_key"});
  return {portable:blockers.length===0,blockers,warnings,summary:{blockers:blockers.length,warnings:warnings.length,connections:(connections??[]).length,assets:(assets??[]).length}};
}

export async function planUpgrade(params:{workspaceId:string;environmentId:string;actorId:string;targetAppVersion?:string|null;targetMigration?:string|null}){
  const db=createServiceRoleClient();const {data:runtime}=await db.from("cms_runtime_state").select("*").eq("singleton",true).maybeSingle();const targetApp=params.targetAppVersion??process.env.npm_package_version??"1.0.0",targetMigration=params.targetMigration??runtime?.schema_migration??"unknown";const migrationChange=runtime?.schema_migration!==targetMigration;const appChange=runtime?.app_version!==targetApp;const risk=migrationChange?"review":"safe";const plan={from:{appVersion:runtime?.app_version??null,migration:runtime?.schema_migration??null,workerVersion:runtime?.worker_version??null},to:{appVersion:targetApp,migration:targetMigration},changes:{application:appChange,database:migrationChange},backupRequired:migrationChange,recommendation:migrationChange?"Create and verify a backup before running database migrations.":"No database migration change detected."};const {data,error}=await db.from("environment_upgrade_runs").insert({workspace_id:params.workspaceId,environment_id:params.environmentId,from_app_version:runtime?.app_version??null,to_app_version:targetApp,current_migration:runtime?.schema_migration??null,target_migration:targetMigration,status:"planned",risk,plan_json:plan,created_by:params.actorId}).select().single();if(error||!data)throw new Error(error?.message||"Could not create upgrade plan");return data;
}

export async function bindWebsiteConnection(params:{workspaceId:string;environmentId:string;connectionId:string;actorId:string;integrationMethod:"polynovea_rest"|"signed_webhook"|"custom_rest"|"wordpress";modelApiKeys?:string[];routeMapping?:Record<string,unknown>}){
  const db=createServiceRoleClient();const connection=await getConnection(params.workspaceId,params.connectionId);if(!connection||connection.environment_id!==params.environmentId)throw Object.assign(new Error("Website connection not found in environment"),{status:404});if(connection.connector_family!=="website"&&connection.connector_family!=="webhook"&&connection.connector_family!=="custom")throw new Error("Selected connection is not a website/publishing connector");if(connection.status!=="active")throw Object.assign(new Error("Verify the connection before binding it for publishing"),{status:409});
  const url=String((connection.config_json as any)?.publishUrl||(connection.config_json as any)?.baseUrl||(connection.config_json as any)?.endpointUrl||"");if(!url)throw new Error("Connection does not define a publishing URL");
  const {data:existing}=await db.from("website_connection_bindings").select("id,publication_target_id").eq("workspace_id",params.workspaceId).eq("environment_id",params.environmentId).eq("connection_id",params.connectionId).maybeSingle();
  let targetId=existing?.publication_target_id??null;
  if(!targetId){const {data:target,error:targetError}=await db.from("publication_targets").insert({workspace_id:params.workspaceId,name:`${connection.name} (${params.integrationMethod})`,target_type:params.integrationMethod==="signed_webhook"?"webhook":"custom_http",config_json_encrypted:"connection-ref:v1",connection_id:params.connectionId,created_by:params.actorId}).select("id").single();if(targetError||!target)throw new Error(targetError?.message||"Could not create connection-backed publication target");targetId=target.id;}
  const {data,error}=await db.from("website_connection_bindings").upsert({workspace_id:params.workspaceId,environment_id:params.environmentId,connection_id:params.connectionId,publication_target_id:targetId,integration_method:params.integrationMethod,model_api_keys:[...new Set(params.modelApiKeys??[])],route_mapping_json:params.routeMapping??{},status:"active",created_by:params.actorId,updated_at:new Date().toISOString()},{onConflict:"environment_id,connection_id"}).select().single();if(error||!data)throw new Error(error?.message||"Could not bind website connection");return {...data,publicationSigningSecret:null,credentialSource:"connection"};
}

export async function queueWebsiteTest(params:{workspaceId:string;bindingId:string;actorId:string}){
  const db=createServiceRoleClient();const {data:binding}=await db.from("website_connection_bindings").select("*").eq("workspace_id",params.workspaceId).eq("id",params.bindingId).maybeSingle();if(!binding)throw Object.assign(new Error("Website binding not found"),{status:404});const idempotencyKey=`website-test:${binding.id}:${Date.now()}`;const job=await enqueueDeliveryJob({workspaceId:params.workspaceId,actorId:params.actorId,kind:"publish",idempotencyKey,payload:{websiteBindingId:binding.id,test:true},safeMetadata:{websiteBindingId:binding.id,test:true},queueName:process.env.POLYNOVEA_WEBSITE_TEST_QUEUE||"default",maxAttempts:2});await db.from("website_connection_bindings").update({status:"testing",last_test_job_id:job.id,last_test_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",binding.id);return job;
}

export async function requestInfrastructureApproval(params:{workspaceId:string;environmentId?:string|null;actorId:string;operation:string;entityType:string;entityId:string;reason:string;request?:Record<string,unknown>}){
  const {data,error}=await createServiceRoleClient().rpc("cms_request_infrastructure_approval",{p_workspace_id:params.workspaceId,p_environment_id:params.environmentId??null,p_actor_id:params.actorId,p_operation:params.operation,p_entity_type:params.entityType,p_entity_id:params.entityId,p_reason:params.reason,p_request_json:params.request??{}});if(error||!data)throw new Error(error?.message||"Could not request approval");return data;
}
export async function reviewInfrastructureApproval(params:{workspaceId:string;actorId:string;requestId:string;decision:"approved"|"rejected";note?:string|null}){const {data,error}=await createServiceRoleClient().rpc("cms_review_infrastructure_approval",{p_workspace_id:params.workspaceId,p_actor_id:params.actorId,p_request_id:params.requestId,p_decision:params.decision,p_note:params.note??null});if(error||!data)throw Object.assign(new Error(error?.message||"Could not review approval"),{status:error?.code==="40300"?403:400});return data;}

export async function runComponentAction(params:{workspaceId:string;environmentId:string;actorId:string;componentId:string;operation:"check"|"deploy"|"redeploy"|"upgrade"|"repair";approvalRequestId?:string|null}){
  const db=createServiceRoleClient();const {data:component}=await db.from("environment_components").select("*").eq("workspace_id",params.workspaceId).eq("environment_id",params.environmentId).eq("id",params.componentId).maybeSingle();if(!component)throw Object.assign(new Error("Environment component not found"),{status:404});
  const {data:env}=await db.from("workspace_environments").select("kind,runtime_provider,database_provider,storage_provider").eq("workspace_id",params.workspaceId).eq("id",params.environmentId).maybeSingle();if(!env)throw Object.assign(new Error("Environment not found"),{status:404});
  let approvalRequestId=params.approvalRequestId??null;if(env.kind==="production"&&params.operation!=="check"){approvalRequestId=await resolveApprovedInfrastructureRequest({workspaceId:params.workspaceId,environmentId:params.environmentId,operation:"component_deploy",entityId:params.componentId,approvalRequestId});if(!approvalRequestId)throw Object.assign(new Error("Production component changes require approval."),{status:409,requiresApproval:true});}
  let status:"succeeded"|"unsupported"|"blocked"="succeeded",state=component.state,instructions:string|null=null,providerResult:Record<string,unknown>|null=null;
  const supabaseEdge=component.component_key==="edge-runtime"&&String(component.provider||env.runtime_provider||"").toLowerCase().includes("supabase");
  if(supabaseEdge){
    const configured=edgeFunctionManifestsFromComponent(component.metadata_json);const packaged=await discoverPackagedSupabaseEdgeFunctions();const bySlug=new Map(packaged.map(item=>[item.slug,item]));for(const item of configured)bySlug.set(item.slug,item);const manifests=[...bySlug.values()];
    try{
      if(params.operation==="check"){
        const inspection=await inspectSupabaseEdgeRuntime(params.workspaceId,params.environmentId);const missing=manifests.map(item=>item.slug).filter(slug=>!inspection.functions.some(fn=>fn.slug===slug&&fn.status==="ACTIVE"));
        state=missing.length?"missing":"present";instructions=missing.length?`Missing/inactive Supabase Edge Functions: ${missing.join(", ")}. Run Deploy/Guide after review.`:manifests.length?"All declared Supabase Edge Functions are active.":"Supabase Management API is reachable; no packaged/declared Edge Functions are required by this release.";
        providerResult={inspection,declaredFunctions:manifests.map(item=>item.slug),missing};
      }else if(!manifests.length){
        const inspection=await inspectSupabaseEdgeRuntime(params.workspaceId,params.environmentId);state="present";instructions="No packaged or component-declared Supabase Edge Functions require deployment.";providerResult={inspection,declaredFunctions:[]};
      }else{
        const deployment=await deploySupabaseEdgeFunctions({workspaceId:params.workspaceId,environmentId:params.environmentId,manifests});state="present";providerResult={deployment};instructions=`Deployed and independently re-verified ${manifests.length} Supabase Edge Function(s).`;
      }
    }catch(error){status="blocked";state="degraded";instructions=error instanceof Error?error.message:"Supabase provider-management action failed";providerResult={error:instructions};}
  }else if(params.operation==="check"){state=component.provider?"present":component.required?"missing":"unsupported";}
  else if(env.kind==="local"&&component.component_key==="edge-runtime"){instructions="The core Local Workspace does not require an edge runtime. Add a supported edge-runtime adapter only if a feature/extension declares that capability.";status="unsupported";state="unsupported";}
  else if(env.kind==="local"&&component.component_key==="object-storage"&&!component.provider){instructions="Local object storage is optional. Configure an object-storage adapter only when media requirements need it.";status="unsupported";state="unsupported";}
  else if(env.kind==="local"){instructions="Use the Local Workspace controls on Setup & Infrastructure. The local adapter deploys PostgreSQL, Auth/REST gateway, CMS and durable worker as one governed runtime.";status="succeeded";state="present";}
  else if(["postgres","secret-store"].includes(component.component_key)){state="present";status="succeeded";}
  else{status="unsupported";state="unsupported";instructions="Automatic "+component.component_key+" deployment is not available for provider "+(component.provider||"unconfigured")+". Configure a supported environment adapter or deploy the documented component, then run Check again.";}
  const {data:run,error}=await db.from("environment_component_runs").insert({workspace_id:params.workspaceId,environment_id:params.environmentId,component_id:component.id,operation:params.operation,status,provider:component.provider,correlation_id:randomUUID(),result_json:{state,providerResult},generated_instructions:instructions,created_by:params.actorId,started_at:new Date().toISOString(),completed_at:new Date().toISOString()}).select().single();if(error||!run)throw new Error(error?.message||"Could not record component action");
  await db.from("environment_components").update({state,last_checked_at:new Date().toISOString(),last_deployed_at:status==="succeeded"&&params.operation!=="check"?new Date().toISOString():component.last_deployed_at,last_error:status==="succeeded"?null:instructions,updated_at:new Date().toISOString()}).eq("id",component.id);if(status==="succeeded"&&params.operation!=="check")await markInfrastructureApprovalExecuted(params.workspaceId,approvalRequestId);return run;
}

export async function executeUpgrade(params:{workspaceId:string;environmentId:string;actorId:string;upgradeRunId:string;backupId?:string|null;approvalRequestId?:string|null}){
  const db=createServiceRoleClient();const {data:run}=await db.from("environment_upgrade_runs").select("*").eq("workspace_id",params.workspaceId).eq("environment_id",params.environmentId).eq("id",params.upgradeRunId).maybeSingle();if(!run)throw Object.assign(new Error("Upgrade plan not found"),{status:404});if(run.status!=="planned"&&run.status!=="blocked")throw Object.assign(new Error("Upgrade plan is not executable"),{status:409});
  const requiresBackup=Boolean(run.plan_json?.backupRequired);if(requiresBackup){if(!params.backupId)throw Object.assign(new Error("This upgrade requires a verified backup"),{status:409});const {data:backup}=await db.from("workspace_backups").select("id,status").eq("workspace_id",params.workspaceId).eq("id",params.backupId).eq("status","verified").maybeSingle();if(!backup)throw Object.assign(new Error("Verified backup not found"),{status:409});}
  let approvalRequestId=params.approvalRequestId??null;if(run.risk!=="safe"){approvalRequestId=await resolveApprovedInfrastructureRequest({workspaceId:params.workspaceId,environmentId:params.environmentId,operation:"upgrade",entityId:run.id,approvalRequestId});if(!approvalRequestId)throw Object.assign(new Error("Upgrade requires an approved infrastructure request"),{status:409,requiresApproval:true});}
  const {data:env}=await db.from("workspace_environments").select("kind").eq("workspace_id",params.workspaceId).eq("id",params.environmentId).maybeSingle();const instructions=env?.kind==="local"?"Use Backup & Upgrade in Local Workspace controls; the local adapter rebuilds application/worker and preserves the PostgreSQL volume.":"Provider-specific runtime execution is intentionally adapter-bound. Apply the reviewed migration/release through the environment provider, then rerun System Doctor; this run remains blocked until versions match.";
  const executableWithoutExternalAdapter=run.current_migration===run.target_migration&&run.from_app_version===run.to_app_version;const status=executableWithoutExternalAdapter?"succeeded":"blocked";const {data:updated}=await db.from("environment_upgrade_runs").update({status,backup_id:params.backupId??null,approval_request_id:approvalRequestId,result_json:{executed:executableWithoutExternalAdapter,instructions},completed_at:new Date().toISOString()}).eq("id",run.id).select().single();if(status==="succeeded")await markInfrastructureApprovalExecuted(params.workspaceId,approvalRequestId);return updated;
}
