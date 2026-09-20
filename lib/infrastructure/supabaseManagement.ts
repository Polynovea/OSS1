import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { resolveConnectionCredentials, redactCredentials } from "@/lib/infrastructure/credentialProvider";

const MANAGEMENT_ORIGIN = "https://api.supabase.com";
const MAX_EDGE_FILE_BYTES = 512 * 1024;
const MAX_EDGE_BUNDLE_BYTES = 4 * 1024 * 1024;

export interface SupabaseEdgeFileManifest {
  path: string;
  content: string;
  contentType?: string;
}

export interface SupabaseEdgeFunctionManifest {
  slug: string;
  name?: string;
  entrypointPath?: string;
  importMapPath?: string | null;
  verifyJwt?: boolean;
  files: SupabaseEdgeFileManifest[];
}

interface SupabaseConnectionRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  connector_type: string;
  name: string;
  status: string;
  active: boolean;
  config_json: Record<string, unknown>;
}

interface RemoteFunction {
  id?: string;
  slug: string;
  name?: string;
  status?: string;
  version?: number;
  updated_at?: number | string;
  verify_jwt?: boolean;
  entrypoint_path?: string;
}

function text(config: Record<string, unknown>, key: string) {
  return typeof config[key] === "string" ? String(config[key]).trim() : "";
}

function deriveProjectRef(config: Record<string, unknown>) {
  const explicit = text(config, "projectRef");
  if (explicit) return explicit;
  const projectUrl = text(config, "projectUrl");
  if (!projectUrl) return "";
  try {
    const hostname = new URL(projectUrl).hostname;
    const suffix = ".supabase.co";
    return hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : "";
  } catch {
    return "";
  }
}

function validateProjectRef(value: string) {
  if (!/^[a-z0-9][a-z0-9-]{5,63}$/i.test(value)) throw new Error("Supabase project ref is missing or invalid");
}

function validateFunctionManifest(manifest: SupabaseEdgeFunctionManifest) {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(manifest.slug)) throw new Error(`Invalid Supabase Edge Function slug: ${manifest.slug}`);
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error(`${manifest.slug}: at least one source file is required`);
  const entrypoint = manifest.entrypointPath || "index.ts";
  let total = 0;
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") throw new Error(`${manifest.slug}: invalid edge function file manifest`);
    const normalized = file.path.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!normalized || normalized.startsWith("/") || normalized.includes("../") || normalized === "..") throw new Error(`${manifest.slug}: unsafe edge function file path ${file.path}`);
    if (seen.has(normalized)) throw new Error(`${manifest.slug}: duplicate edge function file ${normalized}`);
    seen.add(normalized);
    const bytes = Buffer.byteLength(file.content);
    if (bytes > MAX_EDGE_FILE_BYTES) throw new Error(`${manifest.slug}: ${normalized} exceeds ${MAX_EDGE_FILE_BYTES} bytes`);
    total += bytes;
  }
  if (!seen.has(entrypoint)) throw new Error(`${manifest.slug}: entrypoint ${entrypoint} is not present in the declared files`);
  if (total > MAX_EDGE_BUNDLE_BYTES) throw new Error(`${manifest.slug}: source bundle exceeds ${MAX_EDGE_BUNDLE_BYTES} bytes`);
  return { entrypoint, total };
}

async function resolveManagementConnection(workspaceId: string, environmentId: string) {
  const db = createServiceRoleClient();
  const { data, error } = await db.from("workspace_connections").select("*")
    .eq("workspace_id", workspaceId).eq("environment_id", environmentId).eq("connector_type", "database.supabase")
    .eq("active", true).eq("status", "active").order("last_success_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw Object.assign(new Error("No verified Supabase project connection is configured for this environment"), { status: 409 });
  const connection = data as SupabaseConnectionRow;
  const credentials = await resolveConnectionCredentials(workspaceId, connection.id);
  const accessToken = credentials.management_access_token;
  const projectRef = deriveProjectRef(connection.config_json ?? {});
  validateProjectRef(projectRef);
  if (!accessToken) throw Object.assign(new Error("Supabase Management API access token is not configured. Add management_access_token to the Supabase connection to manage Edge Functions."), { status: 409 });
  return { connection, credentials, accessToken, projectRef };
}

async function managementFetch(path: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(`${MANAGEMENT_ORIGIN}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, ...(init.headers || {}) },
    signal: init.signal || AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw Object.assign(new Error(`Supabase Management API returned HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`), { status: response.status });
  }
  return response;
}

export async function inspectSupabaseEdgeRuntime(workspaceId: string, environmentId: string) {
  const resolved = await resolveManagementConnection(workspaceId, environmentId);
  try {
    const response = await managementFetch(`/v1/projects/${encodeURIComponent(resolved.projectRef)}/functions`, resolved.accessToken, { method: "GET" });
    const functions = await response.json() as RemoteFunction[];
    return {
      provider: "supabase",
      projectRef: resolved.projectRef,
      connectionId: resolved.connection.id,
      managementApi: "reachable",
      functions: (Array.isArray(functions) ? functions : []).map(item => ({ slug: item.slug, name: item.name ?? item.slug, status: item.status ?? null, version: item.version ?? null, verifyJwt: item.verify_jwt ?? null, entrypointPath: item.entrypoint_path ?? null })),
    };
  } catch (error) {
    const safe = redactCredentials(error instanceof Error ? error.message : String(error), resolved.credentials);
    throw Object.assign(new Error(safe), { status: (error as { status?: number })?.status || 400 });
  }
}

export async function deploySupabaseEdgeFunctions(params: { workspaceId: string; environmentId: string; manifests: SupabaseEdgeFunctionManifest[] }) {
  const resolved = await resolveManagementConnection(params.workspaceId, params.environmentId);
  const before = await inspectSupabaseEdgeRuntime(params.workspaceId, params.environmentId);
  const deployed: Array<Record<string, unknown>> = [];
  try {
    for (const manifest of params.manifests) {
      const validated = validateFunctionManifest(manifest);
      const form = new FormData();
      form.set("metadata", JSON.stringify({
        name: manifest.name || manifest.slug,
        entrypoint_path: validated.entrypoint,
        ...(manifest.importMapPath ? { import_map_path: manifest.importMapPath } : {}),
        verify_jwt: manifest.verifyJwt !== false,
      }));
      for (const file of manifest.files) {
        const normalized = file.path.replace(/\\/g, "/").replace(/^\.\//, "");
        form.append("file", new File([file.content], normalized, { type: file.contentType || "application/typescript" }));
      }
      const response = await managementFetch(`/v1/projects/${encodeURIComponent(resolved.projectRef)}/functions/deploy?slug=${encodeURIComponent(manifest.slug)}`, resolved.accessToken, { method: "POST", body: form });
      const result = await response.json() as RemoteFunction;
      deployed.push({ slug: result.slug || manifest.slug, status: result.status ?? "ACTIVE", version: result.version ?? null, sourceSha256: createHash("sha256").update(manifest.files.map(file => `${file.path}\n${file.content}`).join("\n---\n")).digest("hex"), sourceBytes: validated.total });
    }
    const after = await inspectSupabaseEdgeRuntime(params.workspaceId, params.environmentId);
    const missing = params.manifests.map(item => item.slug).filter(slug => !after.functions.some(item => item.slug === slug && item.status === "ACTIVE"));
    if (missing.length) throw new Error(`Supabase reported deployment completion but these functions are not ACTIVE: ${missing.join(", ")}`);
    return { provider: "supabase", projectRef: resolved.projectRef, connectionId: resolved.connection.id, deployed, before: before.functions, after: after.functions };
  } catch (error) {
    const safe = redactCredentials(error instanceof Error ? error.message : String(error), resolved.credentials);
    throw Object.assign(new Error(safe), { status: (error as { status?: number })?.status || 400 });
  }
}

export async function discoverPackagedSupabaseEdgeFunctions(): Promise<SupabaseEdgeFunctionManifest[]> {
  const root=path.resolve(process.cwd(),"supabase/functions");
  let dirs:Awaited<ReturnType<typeof readdir>>;
  try{dirs=await readdir(root,{withFileTypes:true}) as any;}catch{return [];}
  const manifests:SupabaseEdgeFunctionManifest[]=[];
  for(const dir of dirs as any[]){
    if(!dir.isDirectory()||dir.name.startsWith("."))continue;
    const slug=dir.name;
    const base=path.join(root,slug);
    const files:SupabaseEdgeFileManifest[]=[];
    const walk=async(current:string,prefix="")=>{
      const entries=await readdir(current,{withFileTypes:true});
      for(const entry of entries){
        if(entry.name.startsWith("."))continue;
        const rel=prefix?`${prefix}/${entry.name}`:entry.name;
        const full=path.join(current,entry.name);
        if(entry.isDirectory()){await walk(full,rel);continue;}
        if(!entry.isFile()||entry.name==="function.json")continue;
        if(!/\.(?:ts|tsx|js|mjs|cjs|json|map|wasm|txt)$/i.test(entry.name))continue;
        const content=await readFile(full,"utf8");
        files.push({path:rel,content,contentType:entry.name.endsWith(".json")?"application/json":"application/typescript"});
      }
    };
    await walk(base);
    let meta:any={};
    try{meta=JSON.parse(await readFile(path.join(base,"function.json"),"utf8"));}catch{}
    const entrypointPath=typeof meta.entrypointPath==="string"?meta.entrypointPath:(files.some(file=>file.path==="index.ts")?"index.ts":files[0]?.path);
    if(!entrypointPath||!files.length)continue;
    manifests.push({slug,name:typeof meta.name==="string"?meta.name:slug,entrypointPath,importMapPath:typeof meta.importMapPath==="string"?meta.importMapPath:null,verifyJwt:meta.verifyJwt!==false,files});
  }
  return manifests;
}

export function edgeFunctionManifestsFromComponent(metadata: unknown): SupabaseEdgeFunctionManifest[] {
  if (!metadata || typeof metadata !== "object") return [];
  const value = (metadata as Record<string, unknown>).supabaseEdgeFunctions;
  if (!Array.isArray(value)) return [];
  return value.map(item => item as SupabaseEdgeFunctionManifest);
}
