import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import type { EnvironmentKind, EnvironmentStatus, SecretProviderKind, WorkspaceEnvironmentRow } from "@/lib/infrastructure/types";

function normalizeUrl(value?: string | null) {
  const raw=value?.trim()||""; if(!raw) return null;
  const url=new URL(raw); if(!["http:","https:"].includes(url.protocol)) throw new Error("Environment URLs must use HTTP or HTTPS");
  url.hash=""; return url.toString().replace(/\/$/,"");
}
function normalizePublicUrls(values?: unknown) {
  if(!Array.isArray(values)) return [] as string[];
  return [...new Set(values.map(v=>normalizeUrl(String(v))).filter((v):v is string=>Boolean(v)))];
}

export async function listEnvironments(workspaceId:string) {
  const db=createServiceRoleClient();
  const [{data:environments,error},{data:providers},{data:components},{data:connections}]=await Promise.all([
    db.from("workspace_environments").select("*").eq("workspace_id",workspaceId).order("created_at",{ascending:true}),
    db.from("workspace_secret_providers").select("id,environment_id,provider_kind,name,status,config_json,created_at,updated_at").eq("workspace_id",workspaceId),
    db.from("environment_components").select("id,environment_id,capability_key,component_key,provider,required,state,current_version,required_version,last_checked_at,last_error").eq("workspace_id",workspaceId),
    db.from("workspace_connections").select("id,environment_id,status").eq("workspace_id",workspaceId),
  ]);
  if(error) throw new Error(error.message);
  return (environments??[]).map((environment)=>({
    ...environment,
    secretProviders:(providers??[]).filter(p=>p.environment_id===environment.id),
    components:(components??[]).filter(c=>c.environment_id===environment.id),
    connectionSummary:{
      total:(connections??[]).filter(c=>c.environment_id===environment.id).length,
      healthy:(connections??[]).filter(c=>c.environment_id===environment.id&&c.status==="active").length,
      degraded:(connections??[]).filter(c=>c.environment_id===environment.id&&["degraded","failed"].includes(c.status)).length,
    },
  }));
}

export async function getEnvironment(workspaceId:string,environmentId:string){
  const all=await listEnvironments(workspaceId);return all.find(e=>e.id===environmentId)??null;
}

export async function createEnvironment(params:{workspaceId:string;actorId:string;key:string;name:string;kind:EnvironmentKind;isDefault?:boolean;cmsBaseUrl?:string|null;publicSiteUrls?:unknown;databaseProvider?:string|null;storageProvider?:string|null;runtimeProvider?:string|null;secretProviderKind?:SecretProviderKind}){
  const key=params.key.trim().toLowerCase();if(!/^[a-z][a-z0-9_-]{0,62}$/.test(key))throw new Error("Environment key must start with a letter and contain only lowercase letters, numbers, _ or -");
  const name=params.name.trim();if(!name)throw new Error("Environment name is required");
  const db=createServiceRoleClient();
  const {data,error}=await db.rpc("cms_create_environment",{
    p_workspace_id:params.workspaceId,p_actor_id:params.actorId,p_key:key,p_name:name,p_kind:params.kind,p_is_default:Boolean(params.isDefault),
    p_cms_base_url:normalizeUrl(params.cmsBaseUrl),p_public_site_urls:normalizePublicUrls(params.publicSiteUrls),p_database_provider:params.databaseProvider?.trim()||null,p_storage_provider:params.storageProvider?.trim()||null,p_runtime_provider:params.runtimeProvider?.trim()||null,p_secret_provider_kind:params.secretProviderKind??"encrypted_postgres",
  });
  if(error||!data){const conflict=error?.code==="23505";throw Object.assign(new Error(error?.message||"Could not create environment"),{status:conflict?409:400});}
  return data;
}

export async function updateEnvironment(params:{workspaceId:string;actorId:string;environmentId:string;name:string;status:EnvironmentStatus;isDefault:boolean;cmsBaseUrl?:string|null;publicSiteUrls?:unknown;databaseProvider?:string|null;storageProvider?:string|null;runtimeProvider?:string|null;config?:Record<string,unknown>}){
  const name=params.name.trim();if(!name)throw new Error("Environment name is required");
  const {data,error}=await createServiceRoleClient().rpc("cms_update_environment",{
    p_workspace_id:params.workspaceId,p_actor_id:params.actorId,p_environment_id:params.environmentId,p_name:name,p_status:params.status,p_is_default:params.isDefault,
    p_cms_base_url:normalizeUrl(params.cmsBaseUrl),p_public_site_urls:normalizePublicUrls(params.publicSiteUrls),p_database_provider:params.databaseProvider?.trim()||null,p_storage_provider:params.storageProvider?.trim()||null,p_runtime_provider:params.runtimeProvider?.trim()||null,p_config_json:params.config??{},
  });
  if(error||!data)throw Object.assign(new Error(error?.message||"Could not update environment"),{status:error?.code==="P0002"?404:400});
  return data as WorkspaceEnvironmentRow;
}
