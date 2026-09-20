import { randomUUID } from "node:crypto";
import { assertSafeOutboundUrl, safeFetch } from "@/lib/infrastructure/networkSafety";
import { probePostgresUrl } from "@/lib/infrastructure/databaseProvisioning";
import type { ConnectorFamily, EnvironmentKind } from "@/lib/infrastructure/types";

export interface ConnectorConfigField {
  key: string;
  label: string;
  type: "text" | "url" | "select" | "number";
  required?: boolean;
  placeholder?: string;
  description?: string;
  options?: string[];
}
export interface ConnectorCredentialField {
  purpose: string;
  label: string;
  required?: boolean;
  defaultEnvironmentVariable?: string;
  multiline?: boolean;
  description?: string;
}
export interface ConnectionVerificationCheck {
  key: string;
  label: string;
  status: "passed" | "warning" | "failed";
  message: string;
}
export interface ConnectionVerificationOutcome {
  status: "passed" | "warning" | "failed";
  checks: ConnectionVerificationCheck[];
  safeEvidence?: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
}
export interface ConnectorDefinition {
  type: string;
  family: ConnectorFamily;
  label: string;
  description: string;
  configFields: ConnectorConfigField[];
  credentials: ConnectorCredentialField[];
  verify: (input: { config: Record<string, unknown>; credentials: Record<string, string>; environmentKind: EnvironmentKind }) => Promise<ConnectionVerificationOutcome>;
}

const text = (config: Record<string, unknown>, key: string) => typeof config[key] === "string" ? String(config[key]).trim() : "";
const passed = (key:string,label:string,message:string):ConnectionVerificationCheck=>({key,label,status:"passed",message});
const failed = (key:string,label:string,message:string):ConnectionVerificationCheck=>({key,label,status:"failed",message});

function validateConfig(definition: ConnectorDefinition, config: Record<string, unknown>) {
  for (const field of definition.configFields) {
    const value=config[field.key];
    if (field.required && (value===undefined || value===null || String(value).trim()==="")) throw new Error(`${field.label} is required`);
    if (field.type==="url" && value) { try { new URL(String(value)); } catch { throw new Error(`${field.label} must be a valid URL`); } }
    if (field.type==="number" && value!==undefined && value!==null && value!=="" && !Number.isFinite(Number(value))) throw new Error(`${field.label} must be a number`);
    if (field.type==="select" && value && field.options?.length && !field.options.includes(String(value))) throw new Error(`${field.label} has an unsupported value`);
  }
}

async function verifyGa4({config,credentials}:{config:Record<string,unknown>;credentials:Record<string,string>;environmentKind:EnvironmentKind}):Promise<ConnectionVerificationOutcome>{
  const propertyId=text(config,"propertyId");
  if(!propertyId) throw new Error("GA4 Property ID is required");
  if(!/^\d+$/.test(propertyId)) throw new Error("GA4 Property ID must contain digits only");
  const clientEmail=credentials.client_email;
  const privateKey=credentials.private_key?.replace(/\\n/g,"\n");
  if(!clientEmail||!privateKey) throw new Error("GA4 service-account credentials are incomplete");
  const { BetaAnalyticsDataClient } = await import("@google-analytics/data");
  const client=new BetaAnalyticsDataClient({credentials:{client_email:clientEmail,private_key:privateKey}});
  await client.runReport({property:`properties/${propertyId}`,dateRanges:[{startDate:"7daysAgo",endDate:"today"}],metrics:[{name:"activeUsers"}],limit:1});
  return {status:"passed",checks:[passed("credentials","Credentials","Service-account credentials were accepted."),passed("property","GA4 property","The configured GA4 property is accessible.")],safeEvidence:{provider:"ga4",propertyId}};
}

async function verifyHttp(input:{config:Record<string,unknown>;credentials:Record<string,string>;environmentKind:EnvironmentKind}):Promise<ConnectionVerificationOutcome>{
  const baseUrl=text(input.config,"baseUrl")||text(input.config,"endpointUrl");
  if(!baseUrl) throw new Error("Base URL is required");
  const testPath=text(input.config,"testPath");
  const method=(text(input.config,"testMethod")||"GET").toUpperCase();
  if(!["GET","HEAD"].includes(method)) throw new Error("Connection tests may use only GET or HEAD");
  const target=new URL(testPath||"/",baseUrl).toString();
  const headers=new Headers({"user-agent":"Polynovea-CMS-Connection-Verifier/1.0"});
  if(input.credentials.bearer_token) headers.set("authorization",`Bearer ${input.credentials.bearer_token}`);
  if(input.credentials.api_key){const header=(text(input.config,"apiKeyHeader")||"x-api-key").toLowerCase();if(!/^[a-z0-9-]{1,64}$/.test(header))throw new Error("API key header name is invalid");headers.set(header,input.credentials.api_key);}
  const response=await safeFetch(target,input.environmentKind,{method,headers,signal:AbortSignal.timeout(10_000)});
  const okay=response.status>=200&&response.status<400;
  return {status:okay?"passed":"failed",checks:[okay?passed("http","HTTP endpoint",`Endpoint responded with HTTP ${response.status}.`):failed("http","HTTP endpoint",`Endpoint responded with HTTP ${response.status}.`)],safeEvidence:{url:new URL(target).origin,status:response.status,method},errorCode:okay?null:"HTTP_STATUS",errorMessage:okay?null:`Endpoint returned HTTP ${response.status}`};
}

async function verifySupabase(input:{config:Record<string,unknown>;credentials:Record<string,string>;environmentKind:EnvironmentKind}):Promise<ConnectionVerificationOutcome>{
  const projectUrl=text(input.config,"projectUrl");if(!projectUrl)throw new Error("Supabase project URL is required");
  const key=input.credentials.service_role_key||input.credentials.anon_key;if(!key)throw new Error("A Supabase API key is required");
  const target=new URL("/rest/v1/",projectUrl).toString();
  const response=await safeFetch(target,input.environmentKind,{method:"GET",headers:{apikey:key,authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10_000)});
  const okay=response.status>=200&&response.status<500&&response.status!==401&&response.status!==403;
  return {status:okay?"passed":"failed",checks:[okay?passed("project","Supabase project",`REST API is reachable (HTTP ${response.status}).`):failed("project","Supabase project",`REST API rejected the configured credential (HTTP ${response.status}).`)],safeEvidence:{projectOrigin:new URL(projectUrl).origin,status:response.status},errorCode:okay?null:"SUPABASE_AUTH",errorMessage:okay?null:`Supabase verification returned HTTP ${response.status}`};
}

async function verifyS3Storage(input:{config:Record<string,unknown>;credentials:Record<string,string>;environmentKind:EnvironmentKind},kind:"r2"|"s3"|"minio"):Promise<ConnectionVerificationOutcome>{
  const bucket=text(input.config,"bucket");
  let region=text(input.config,"region")||"us-east-1",endpoint=text(input.config,"endpoint")||undefined,forcePathStyle=false;
  const accessKeyId=input.credentials.access_key_id||text(input.config,"accessKeyId"),secret=input.credentials.secret_access_key;
  if(kind==="r2"){
    const accountId=text(input.config,"accountId");if(!/^[A-Za-z0-9_-]{6,128}$/.test(accountId))throw new Error("R2 Account ID is invalid");
    endpoint=endpoint||`https://${accountId}.r2.cloudflarestorage.com`;region="auto";
  }
  if(kind==="minio"){if(!endpoint)throw new Error("MinIO endpoint is required");forcePathStyle=true;}
  if(!bucket||!accessKeyId||!secret)throw new Error(`${kind.toUpperCase()} bucket and credentials are required`);
  if(endpoint)await assertSafeOutboundUrl(endpoint,input.environmentKind,{allowHttpLocal:true});
  const { S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const client=new S3Client({region,endpoint,forcePathStyle,credentials:{accessKeyId,secretAccessKey:secret}});
  await client.send(new HeadBucketCommand({Bucket:bucket}));
  const probeKey=`.polynovea-verification/${randomUUID()}.txt`,probeBody=`polynovea-storage-verification:${randomUUID()}`;
  try{
    await client.send(new PutObjectCommand({Bucket:bucket,Key:probeKey,Body:probeBody,ContentType:"text/plain"}));
    const downloaded=await client.send(new GetObjectCommand({Bucket:bucket,Key:probeKey}));
    const received=downloaded.Body?await downloaded.Body.transformToString():"";
    if(received!==probeBody)throw new Error("Storage read-back did not match the disposable verification object");
  }finally{await client.send(new DeleteObjectCommand({Bucket:bucket,Key:probeKey})).catch(()=>undefined);}
  return {status:"passed",checks:[passed("bucket","Bucket access","Bucket exists and is accessible."),passed("roundtrip","Read/write/delete","Disposable object write, read-back and delete succeeded.")],safeEvidence:{provider:kind,bucket,region,endpointOrigin:endpoint?new URL(endpoint).origin:null}};
}
const verifyR2=(input:{config:Record<string,unknown>;credentials:Record<string,string>;environmentKind:EnvironmentKind})=>verifyS3Storage(input,"r2");
const verifyS3=(input:{config:Record<string,unknown>;credentials:Record<string,string>;environmentKind:EnvironmentKind})=>verifyS3Storage(input,"s3");
const verifyMinio=(input:{config:Record<string,unknown>;credentials:Record<string,string>;environmentKind:EnvironmentKind})=>verifyS3Storage(input,"minio");

async function verifySupabaseStorage(input:{config:Record<string,unknown>;credentials:Record<string,string>;environmentKind:EnvironmentKind}):Promise<ConnectionVerificationOutcome>{
  const projectUrl=text(input.config,"projectUrl"),bucket=text(input.config,"bucket"),key=input.credentials.service_role_key||input.credentials.anon_key;
  if(!projectUrl||!bucket||!key)throw new Error("Supabase Storage project URL, bucket and API key are required");
  await assertSafeOutboundUrl(projectUrl,input.environmentKind,{allowHttpLocal:true});
  const probePath=`.polynovea-verification/${randomUUID()}.txt`,probeBody=`polynovea-storage-verification:${randomUUID()}`;
  const authHeaders={apikey:key,authorization:`Bearer ${key}`};
  const listRes=await safeFetch(new URL("/storage/v1/bucket",projectUrl).toString(),input.environmentKind,{method:"GET",headers:authHeaders,signal:AbortSignal.timeout(10_000)});
  if(!listRes.ok)throw new Error(`Supabase Storage bucket list failed: HTTP ${listRes.status}`);
  const buckets=await listRes.json().catch(()=>[]) as Array<{name?:string;id?:string}>;
  if(!buckets.some(item=>item.name===bucket||item.id===bucket))throw new Error(`Supabase Storage bucket ${bucket} was not found`);
  try{
    const upRes=await safeFetch(new URL(`/storage/v1/object/${encodeURIComponent(bucket)}/${probePath}`,projectUrl).toString(),input.environmentKind,{method:"POST",headers:{...authHeaders,"content-type":"text/plain"},body:probeBody,signal:AbortSignal.timeout(10_000)});
    if(!upRes.ok)throw new Error(`Supabase Storage upload failed: HTTP ${upRes.status}`);
    const dlRes=await safeFetch(new URL(`/storage/v1/object/${encodeURIComponent(bucket)}/${probePath}`,projectUrl).toString(),input.environmentKind,{method:"GET",headers:authHeaders,signal:AbortSignal.timeout(10_000)});
    if(!dlRes.ok)throw new Error(`Supabase Storage download failed: HTTP ${dlRes.status}`);
    const received=await dlRes.text();
    if(received!==probeBody)throw new Error("Supabase Storage read-back did not match the disposable verification object");
  }finally{
    await safeFetch(new URL(`/storage/v1/object/${encodeURIComponent(bucket)}`,projectUrl).toString(),input.environmentKind,{method:"DELETE",headers:{...authHeaders,"content-type":"application/json"},body:JSON.stringify({prefixes:[probePath]}),signal:AbortSignal.timeout(10_000)}).catch(()=>undefined);
  }
  return {status:"passed",checks:[passed("bucket","Supabase Storage bucket","Bucket exists and is accessible."),passed("roundtrip","Read/write/delete","Disposable object write, read-back and delete succeeded.")],safeEvidence:{provider:"supabase-storage",bucket,projectOrigin:new URL(projectUrl).origin}};
}

async function verifyPostgres(input:{config:Record<string,unknown>;credentials:Record<string,string>;environmentKind:EnvironmentKind}):Promise<ConnectionVerificationOutcome>{
  const connectionUrl=input.credentials.connection_url;if(!connectionUrl)throw new Error("PostgreSQL Connection URL is required");
  const result=await probePostgresUrl(connectionUrl);
  if(result.major<14)return{status:"failed",checks:[failed("version","PostgreSQL version",`PostgreSQL ${result.version} is below the supported minimum 14.`)],safeEvidence:{major:result.major,database:result.database,ssl:result.ssl},errorCode:"POSTGRES_VERSION",errorMessage:"PostgreSQL 14 or newer is required"};
  return{status:"passed",checks:[passed("connectivity","PostgreSQL connectivity",`Connected to PostgreSQL ${result.version}.`),{key:"tls",label:"TLS",status:result.ssl||input.environmentKind==="local"?"passed":"warning",message:result.ssl?"Database session uses TLS.":"Database session is not using TLS."}],safeEvidence:{major:result.major,database:result.database,ssl:result.ssl}};
}

async function verifyCredentialPresence(input:{config:Record<string,unknown>;credentials:Record<string,string>;environmentKind:EnvironmentKind}):Promise<ConnectionVerificationOutcome>{
  const count=Object.keys(input.credentials).length;
  return {status:"warning",checks:[{key:"adapter",label:"Live verification",status:"warning",message:`${count} credential binding(s) are configured. This connector type has no live provider probe yet.`}],safeEvidence:{credentialsConfigured:count},errorCode:null,errorMessage:null};
}

export const CONNECTOR_REGISTRY: Record<string, ConnectorDefinition> = Object.fromEntries(([
  {type:"analytics.ga4",family:"analytics",label:"Google Analytics 4",description:"Map GA4 outcomes back to published CMS routes and versions.",configFields:[{key:"propertyId",label:"GA4 Property ID",type:"text",required:true,placeholder:"123456789"}],credentials:[{purpose:"client_email",label:"Service Account Email",required:true,defaultEnvironmentVariable:"GA4_CLIENT_EMAIL"},{purpose:"private_key",label:"Service Account Private Key",required:true,defaultEnvironmentVariable:"GA4_PRIVATE_KEY",multiline:true}],verify:verifyGa4},
  {type:"website.rest",family:"website",label:"Website REST API",description:"Publish or test against a website HTTP API.",configFields:[{key:"baseUrl",label:"Base URL",type:"url",required:true},{key:"testPath",label:"Verification Path",type:"text",placeholder:"/api/health"},{key:"testMethod",label:"Verification Method",type:"select",options:["GET","HEAD"]},{key:"apiKeyHeader",label:"API Key Header",type:"text",placeholder:"x-api-key"},{key:"contractKind",label:"Machine-readable Contract",type:"select",options:["openapi","graphql","wordpress","polynovea"],description:"Optional explicit contract type for Phase 12.75 capability discovery."},{key:"contractUrl",label:"Contract URL",type:"url",description:"Optional explicit OpenAPI/GraphQL/WordPress/Polynovea contract endpoint. Only this declared URL is introspected."}],credentials:[{purpose:"bearer_token",label:"Bearer Token"},{purpose:"api_key",label:"API Key"}],verify:verifyHttp},
  {type:"custom.http",family:"custom",label:"Custom REST/API",description:"Constrained custom HTTP connection with safe GET/HEAD verification.",configFields:[{key:"baseUrl",label:"Base URL",type:"url",required:true},{key:"testPath",label:"Verification Path",type:"text"},{key:"testMethod",label:"Verification Method",type:"select",options:["GET","HEAD"]},{key:"apiKeyHeader",label:"API Key Header",type:"text"},{key:"contractKind",label:"Machine-readable Contract",type:"select",options:["openapi","graphql","wordpress","polynovea"],description:"Optional explicit contract type for Phase 12.75 capability discovery."},{key:"contractUrl",label:"Contract URL",type:"url",description:"Optional explicit machine-readable contract endpoint; discovery never guesses a metadata target."}],credentials:[{purpose:"bearer_token",label:"Bearer Token"},{purpose:"api_key",label:"API Key"}],verify:verifyHttp},
  {type:"database.supabase",family:"database",label:"Supabase",description:"Supabase PostgreSQL/Auth/REST project connection. Add the optional direct PostgreSQL URL for one-click migrations and Management API token for provider/component automation.",configFields:[{key:"projectUrl",label:"Project URL",type:"url",required:true},{key:"projectRef",label:"Project Ref",type:"text",description:"Optional when it can be derived from <ref>.supabase.co; required for non-standard project URLs."}],credentials:[{purpose:"service_role_key",label:"Service Role Key",required:true},{purpose:"anon_key",label:"Anon Key"},{purpose:"connection_url",label:"Direct/Pooler PostgreSQL URL",description:"Optional for REST verification; required for automatic DB initialize/upgrade."},{purpose:"management_access_token",label:"Management API Access Token",description:"Optional. Required only for provider-management actions such as discovering/deploying Edge Functions. Use a token scoped to the target project and required management permissions."}],verify:verifySupabase},
  {type:"database.postgres",family:"database",label:"PostgreSQL",description:"Existing PostgreSQL environment with live connectivity verification and guided migration provisioning.",configFields:[{key:"label",label:"Database Label",type:"text"}],credentials:[{purpose:"connection_url",label:"PostgreSQL Connection URL",required:true}],verify:verifyPostgres},
  {type:"storage.r2",family:"storage",label:"Cloudflare R2",description:"S3-compatible Cloudflare R2 object storage used by the CMS media layer.",configFields:[{key:"accountId",label:"Account ID",type:"text",required:true},{key:"bucket",label:"Bucket",type:"text",required:true},{key:"accessKeyId",label:"Access Key ID",type:"text",required:true},{key:"publicUrl",label:"Public/Base Read URL",type:"url"}],credentials:[{purpose:"secret_access_key",label:"Secret Access Key",required:true}],verify:verifyR2},
  {type:"storage.s3",family:"storage",label:"AWS S3 / S3-compatible",description:"AWS S3 object storage with optional custom endpoint and signed/private read support.",configFields:[{key:"bucket",label:"Bucket",type:"text",required:true},{key:"region",label:"Region",type:"text",required:true,placeholder:"ap-south-1"},{key:"endpoint",label:"Custom Endpoint",type:"url"},{key:"publicUrl",label:"Public/CDN Read URL",type:"url"}],credentials:[{purpose:"access_key_id",label:"Access Key ID",required:true},{purpose:"secret_access_key",label:"Secret Access Key",required:true}],verify:verifyS3},
  {type:"storage.minio",family:"storage",label:"MinIO",description:"Self-hosted S3-compatible MinIO object storage.",configFields:[{key:"endpoint",label:"Endpoint",type:"url",required:true},{key:"bucket",label:"Bucket",type:"text",required:true},{key:"region",label:"Region",type:"text",placeholder:"us-east-1"},{key:"publicUrl",label:"Public/Base Read URL",type:"url"}],credentials:[{purpose:"access_key_id",label:"Access Key ID",required:true},{purpose:"secret_access_key",label:"Secret Access Key",required:true}],verify:verifyMinio},
  {type:"storage.supabase",family:"storage",label:"Supabase Storage",description:"Supabase Storage bucket using the environment-scoped Supabase project and credential.",configFields:[{key:"projectUrl",label:"Project URL",type:"url",required:true},{key:"bucket",label:"Bucket",type:"text",required:true},{key:"visibility",label:"Visibility",type:"select",options:["private","public"]},{key:"publicUrl",label:"Custom Public/CDN URL",type:"url"}],credentials:[{purpose:"service_role_key",label:"Service Role Key",required:true}],verify:verifySupabaseStorage},
  {type:"search.http",family:"search",label:"Search Service",description:"HTTP search/indexing destination.",configFields:[{key:"baseUrl",label:"Base URL",type:"url",required:true},{key:"testPath",label:"Health Path",type:"text"}],credentials:[{purpose:"api_key",label:"API Key"},{purpose:"bearer_token",label:"Bearer Token"}],verify:verifyHttp},
  {type:"webhook.signed",family:"webhook",label:"Signed Webhook",description:"Signed outbound webhook endpoint.",configFields:[{key:"endpointUrl",label:"Endpoint URL",type:"url",required:true},{key:"testMethod",label:"Verification Method",type:"select",options:["GET","HEAD"]}],credentials:[{purpose:"signing_secret",label:"Signing Secret",required:true}],verify:verifyHttp},
  {type:"communication.http",family:"communication",label:"Notification API",description:"HTTP notification provider connection.",configFields:[{key:"baseUrl",label:"Base URL",type:"url",required:true},{key:"testPath",label:"Health Path",type:"text"}],credentials:[{purpose:"bearer_token",label:"Bearer/API Token",required:true}],verify:verifyHttp},
  {type:"ai.openai",family:"ai",label:"OpenAI",description:"Credential binding for governed extensions/agents that request an OpenAI connection.",configFields:[{key:"baseUrl",label:"API Base URL",type:"url",placeholder:"https://api.openai.com"}],credentials:[{purpose:"api_key",label:"API Key",required:true}],verify:verifyCredentialPresence},
  {type:"ai.anthropic",family:"ai",label:"Anthropic",description:"Credential binding for governed extensions/agents that request an Anthropic connection.",configFields:[{key:"baseUrl",label:"API Base URL",type:"url",placeholder:"https://api.anthropic.com"}],credentials:[{purpose:"api_key",label:"API Key",required:true}],verify:verifyCredentialPresence},
] satisfies ConnectorDefinition[]).map((definition)=>[definition.type,definition]));

export function listConnectorDefinitions(){return Object.values(CONNECTOR_REGISTRY).map(({verify,...safe})=>safe);}
export function getConnectorDefinition(type:string){return CONNECTOR_REGISTRY[type]??null;}
export function validateConnectorConfiguration(type:string,config:Record<string,unknown>,credentialPurposes:string[]){const definition=getConnectorDefinition(type);if(!definition)throw new Error("Unsupported connector type");validateConfig(definition,config);for(const credential of definition.credentials)if(credential.required&&!credentialPurposes.includes(credential.purpose))throw new Error(`${credential.label} is required`);return definition;}
