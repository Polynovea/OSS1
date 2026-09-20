import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { getConnectorDefinition, listConnectorDefinitions, validateConnectorConfiguration } from "@/lib/infrastructure/connectorRegistry";
import { prepareCredentialForProvider, redactCredentials, resolveConnectionCredentials } from "@/lib/infrastructure/credentialProvider";
import type { ConnectionSafeView, SecretProviderKind, WorkspaceConnectionRow } from "@/lib/infrastructure/types";

export function getConnectorCatalog(){return listConnectorDefinitions();}

export async function listConnections(workspaceId:string):Promise<ConnectionSafeView[]> {
  const db=createServiceRoleClient();
  const [{data:connections,error},{data:environments},{data:bindings},{data:refs},{data:providers},{data:verifications}]=await Promise.all([
    db.from("workspace_connections").select("*").eq("workspace_id",workspaceId).order("created_at",{ascending:false}),
    db.from("workspace_environments").select("id,key,name,kind,status").eq("workspace_id",workspaceId),
    db.from("connection_secret_bindings").select("connection_id,secret_ref_id,purpose").eq("workspace_id",workspaceId),
    db.from("workspace_secret_refs").select("id,provider_id,label,locator,masked_hint,state,last_verified_at,rotated_at").eq("workspace_id",workspaceId),
    db.from("workspace_secret_providers").select("id,provider_kind").eq("workspace_id",workspaceId),
    db.from("connection_verifications").select("id,connection_id,status,checks_json,safe_evidence_json,error_code,error_message,duration_ms,correlation_id,verified_at").eq("workspace_id",workspaceId).order("verified_at",{ascending:false}).limit(1000),
  ]);
  if(error)throw new Error(error.message);
  const envMap=new Map((environments??[]).map(e=>[e.id,e]));const refMap=new Map((refs??[]).map(r=>[r.id,r]));const providerMap=new Map((providers??[]).map(p=>[p.id,p.provider_kind as SecretProviderKind]));
  return (connections??[] as WorkspaceConnectionRow[]).map(connection=>({
    ...connection,
    environment:envMap.get(connection.environment_id)??null,
    secrets:(bindings??[]).filter(b=>b.connection_id===connection.id).map(binding=>{const ref=refMap.get(binding.secret_ref_id);if(!ref)return null;const providerKind=providerMap.get(ref.provider_id)??"external";return{id:ref.id,purpose:binding.purpose,label:ref.label,state:ref.state,providerKind,locator:providerKind==="environment"?ref.locator:undefined,maskedHint:ref.masked_hint,lastVerifiedAt:ref.last_verified_at,rotatedAt:ref.rotated_at};}).filter(Boolean) as ConnectionSafeView["secrets"],
    latestVerification:(verifications??[]).find(v=>v.connection_id===connection.id)??null,
  }));
}

export async function getConnection(workspaceId:string,connectionId:string){return (await listConnections(workspaceId)).find(c=>c.id===connectionId)??null;}

type CredentialInput={purpose:string;value?:string|null;locator?:string|null};
export async function createConnection(params:{workspaceId:string;actorId:string;environmentId:string;connectorType:string;name:string;config?:Record<string,unknown>;secretProviderId?:string|null;credentials?:CredentialInput[]}){
  const db=createServiceRoleClient();
  const {data:environment}=await db.from("workspace_environments").select("id,secret_provider_id").eq("workspace_id",params.workspaceId).eq("id",params.environmentId).maybeSingle();
  if(!environment)throw Object.assign(new Error("Environment not found"),{status:404});
  const providerId=params.secretProviderId||environment.secret_provider_id;if(!providerId)throw new Error("Environment has no active credential provider");
  const {data:provider}=await db.from("workspace_secret_providers").select("id,provider_kind,status").eq("workspace_id",params.workspaceId).eq("environment_id",params.environmentId).eq("id",providerId).maybeSingle();
  if(!provider||provider.status!=="active")throw new Error("Active credential provider not found");
  const definition=getConnectorDefinition(params.connectorType);if(!definition)throw new Error("Unsupported connector type");
  const supplied=new Map((params.credentials??[]).map(item=>[item.purpose,item]));
  const prepared=[];
  for(const credential of definition.credentials){
    const input=supplied.get(credential.purpose);const hasExplicit=Boolean(input?.value?.trim()||input?.locator?.trim());
    if(!credential.required&&!hasExplicit)continue;
    prepared.push(prepareCredentialForProvider({providerKind:provider.provider_kind as SecretProviderKind,purpose:credential.purpose,label:credential.label,value:input?.value,locator:input?.locator,defaultLocator:credential.defaultEnvironmentVariable,metadata:{connectorType:definition.type}}));
  }
  validateConnectorConfiguration(definition.type,params.config??{},prepared.map(p=>p.purpose));
  const name=params.name.trim();if(!name)throw new Error("Connection name is required");
  const {data,error}=await db.rpc("cms_create_connection",{p_workspace_id:params.workspaceId,p_actor_id:params.actorId,p_environment_id:params.environmentId,p_connector_type:definition.type,p_connector_family:definition.family,p_name:name,p_config_json:params.config??{},p_secret_provider_id:provider.id,p_secrets:prepared});
  if(error||!data)throw Object.assign(new Error(error?.message||"Could not create connection"),{status:error?.code==="23505"?409:400});
  const connectionId=(data as {connection?:{id?:string}}).connection?.id;
  if(definition.type==="analytics.ga4"&&connectionId){
    const {error:linkError}=await db.rpc("cms_link_ga4_connection",{p_workspace_id:params.workspaceId,p_actor_id:params.actorId,p_connection_id:connectionId});
    if(linkError)throw new Error(linkError.message||"GA4 connection was created but could not be linked to analytics");
  }
  return data;
}

export async function rotateConnectionCredential(params:{workspaceId:string;actorId:string;connectionId:string;purpose:string;value?:string|null;locator?:string|null;approvalRequestId?:string|null}){
  const db=createServiceRoleClient();
  const {data:connection}=await db.from("workspace_connections").select("id,connector_type,environment_id").eq("workspace_id",params.workspaceId).eq("id",params.connectionId).maybeSingle();if(!connection)throw Object.assign(new Error("Connection not found"),{status:404});
  const {data:environment}=await db.from("workspace_environments").select("id,kind").eq("workspace_id",params.workspaceId).eq("id",connection.environment_id).maybeSingle();if(!environment)throw new Error("Connection environment is unavailable");
  const definition=getConnectorDefinition(connection.connector_type);if(!definition)throw new Error("Connector definition is unavailable");const credential=definition.credentials.find(c=>c.purpose===params.purpose);if(!credential)throw new Error("Unsupported credential purpose for this connector");
  const {data:binding}=await db.from("connection_secret_bindings").select("secret_ref_id").eq("workspace_id",params.workspaceId).eq("connection_id",params.connectionId).eq("purpose",params.purpose).maybeSingle();if(!binding)throw Object.assign(new Error("Credential binding not found"),{status:404});
  const {data:ref}=await db.from("workspace_secret_refs").select("provider_id").eq("workspace_id",params.workspaceId).eq("id",binding.secret_ref_id).maybeSingle();if(!ref)throw new Error("Credential reference not found");
  const {data:provider}=await db.from("workspace_secret_providers").select("provider_kind,status").eq("workspace_id",params.workspaceId).eq("id",ref.provider_id).maybeSingle();if(!provider||provider.status!=="active")throw new Error("Credential provider is unavailable");
  const prepared=prepareCredentialForProvider({providerKind:provider.provider_kind as SecretProviderKind,purpose:credential.purpose,label:credential.label,value:params.value,locator:params.locator,defaultLocator:credential.defaultEnvironmentVariable,metadata:{connectorType:definition.type}});
  let approvalRequestId=params.approvalRequestId??null;
  if(environment.kind==="production"&&!approvalRequestId){const {data:approved}=await db.from("infrastructure_approval_requests").select("id,request_json,expires_at").eq("workspace_id",params.workspaceId).eq("environment_id",environment.id).eq("operation","credential_rotate").eq("entity_id",params.connectionId).eq("status","approved").order("reviewed_at",{ascending:false}).limit(20);approvalRequestId=(approved??[]).find(a=>(!a.expires_at||new Date(a.expires_at)>new Date())&&(!a.request_json?.purpose||a.request_json.purpose===params.purpose))?.id??null;}
  if(environment.kind==="production"&&!approvalRequestId)throw Object.assign(new Error("Production credential rotation requires approval. Request it from Setup & Infrastructure, then retry."),{status:409,requiresApproval:true});
  const {data,error}=await db.rpc("cms_rotate_connection_secret_governed",{p_workspace_id:params.workspaceId,p_actor_id:params.actorId,p_connection_id:params.connectionId,p_purpose:params.purpose,p_locator:prepared.locator,p_encrypted_value:prepared.encryptedValue,p_masked_hint:prepared.maskedHint,p_metadata:prepared.metadata,p_approval_request_id:approvalRequestId});
  if(error||!data)throw Object.assign(new Error(error?.message||"Could not rotate credential"),{status:error?.code==="P0001"?409:400});
  return {id:data.id,state:data.state,maskedHint:data.masked_hint,rotatedAt:data.rotated_at,locator:provider.provider_kind==="environment"?data.locator:undefined};
}

export async function verifyConnection(params:{workspaceId:string;actorId:string;connectionId:string}){
  const db=createServiceRoleClient();
  const {data:connection}=await db.from("workspace_connections").select("*").eq("workspace_id",params.workspaceId).eq("id",params.connectionId).maybeSingle();if(!connection)throw Object.assign(new Error("Connection not found"),{status:404});
  if(!connection.active)throw Object.assign(new Error("Disabled connections cannot be verified"),{status:409});
  const {data:environment}=await db.from("workspace_environments").select("id,kind,status").eq("workspace_id",params.workspaceId).eq("id",connection.environment_id).maybeSingle();if(!environment)throw new Error("Connection environment is unavailable");
  const definition=getConnectorDefinition(connection.connector_type);if(!definition)throw new Error("Connector definition is unavailable");
  const correlationId=randomUUID(),started=Date.now();await db.from("workspace_connections").update({status:"verifying",updated_at:new Date().toISOString()}).eq("workspace_id",params.workspaceId).eq("id",connection.id);
  let credentials:Record<string,string>={};
  try{
    credentials=await resolveConnectionCredentials(params.workspaceId,connection.id);
    validateConnectorConfiguration(definition.type,connection.config_json??{},Object.keys(credentials));
    const outcome=await definition.verify({config:connection.config_json??{},credentials,environmentKind:environment.kind});
    const {data,error}=await db.rpc("cms_record_connection_verification",{p_workspace_id:params.workspaceId,p_actor_id:params.actorId,p_connection_id:connection.id,p_status:outcome.status,p_checks:outcome.checks,p_safe_evidence:outcome.safeEvidence??{},p_error_code:outcome.errorCode??null,p_error_message:outcome.errorMessage??null,p_duration_ms:Date.now()-started,p_correlation_id:correlationId});
    if(error||!data)throw new Error(error?.message||"Could not record connection verification");return data;
  }catch(error){
    const message=redactCredentials(error instanceof Error?error.message:"Connection verification failed",credentials);
    const {data}=await db.rpc("cms_record_connection_verification",{p_workspace_id:params.workspaceId,p_actor_id:params.actorId,p_connection_id:connection.id,p_status:"failed",p_checks:[{key:"verification",label:"Connection verification",status:"failed",message}],p_safe_evidence:{connectorType:definition.type},p_error_code:"VERIFICATION_FAILED",p_error_message:message,p_duration_ms:Date.now()-started,p_correlation_id:correlationId});
    if(data)return data;throw new Error(message);
  }
}
