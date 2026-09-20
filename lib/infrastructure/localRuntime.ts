import { createHmac, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync=promisify(execFile);
const composeFile=path.resolve(process.cwd(),"deploy/local/docker-compose.yml");

const b64=(value:Buffer|string)=>Buffer.from(value).toString("base64url");
function jwt(secret:string,role:"anon"|"service_role"){
  const now=Math.floor(Date.now()/1000);const header=b64(JSON.stringify({alg:"HS256",typ:"JWT"}));const payload=b64(JSON.stringify({iss:"supabase",ref:"local",role,iat:now,exp:2147483647}));const sig=createHmac("sha256",secret).update(`${header}.${payload}`).digest("base64url");return `${header}.${payload}.${sig}`;
}
const q=(value:string)=>`"${value.replace(/\\/g,"/").replace(/"/g,'\\"')}"`;

export interface LocalRuntimeConfig { directory:string; envFile:string; appPort:number; supabasePort:number; }

export function localRuntimeAllowed(){return process.env.POLYNOVEA_LOCAL_RUNTIME_CONTROL==="1";}
export function defaultLocalRuntimeDirectory(){return path.join(os.homedir(),"PolynoveaCMS");}

export async function initializeLocalRuntime(directory?:string|null):Promise<LocalRuntimeConfig>{
  if(!localRuntimeAllowed())throw Object.assign(new Error("Local runtime control is disabled. Set POLYNOVEA_LOCAL_RUNTIME_CONTROL=1 on a local installation to enable it."),{status:403});
  const allowedRoot=path.resolve(process.env.POLYNOVEA_LOCAL_RUNTIME_ROOT||os.homedir());
  const root=path.resolve(directory?.trim()||defaultLocalRuntimeDirectory());
  const relative=path.relative(allowedRoot,root);
  if(relative.startsWith("..")||path.isAbsolute(relative))throw Object.assign(new Error(`Local workspace directory must be inside ${allowedRoot}`),{status:400});
  await mkdir(root,{recursive:true});await mkdir(path.join(root,"postgres"),{recursive:true});await mkdir(path.join(root,"backups"),{recursive:true});
  const envFile=path.join(root,"runtime.env");let exists=true;try{await access(envFile,constants.F_OK);}catch{exists=false;}
  if(!exists){const postgresPassword=randomBytes(24).toString("base64url"),jwtSecret=randomBytes(48).toString("base64url"),encryptionKey=randomBytes(32).toString("base64");const anonKey=jwt(jwtSecret,"anon"),serviceRoleKey=jwt(jwtSecret,"service_role");const appPort=Number(process.env.POLYNOVEA_LOCAL_APP_PORT||3210),supabasePort=Number(process.env.POLYNOVEA_LOCAL_SUPABASE_PORT||54321);
    const lines=[`POLYNOVEA_DATA_DIR=${q(root)}`,`POLYNOVEA_APP_PORT=${appPort}`,`POLYNOVEA_SUPABASE_PORT=${supabasePort}`,`POSTGRES_PASSWORD=${q(postgresPassword)}`,`JWT_SECRET=${q(jwtSecret)}`,`ANON_KEY=${q(anonKey)}`,`SERVICE_ROLE_KEY=${q(serviceRoleKey)}`,`CMS_CONFIG_ENCRYPTION_KEY=${q(encryptionKey)}`,"R2_ENDPOINT=","R2_ACCESS_KEY_ID=","R2_SECRET_ACCESS_KEY=","R2_BUCKET=","R2_PUBLIC_URL="];await writeFile(envFile,lines.join("\n")+"\n",{encoding:"utf8",mode:0o600});}
  const text=await readFile(envFile,"utf8");const read=(key:string)=>text.split(/\r?\n/).find(line=>line.startsWith(`${key}=`))?.slice(key.length+1).replace(/^"|"$/g,"")||"";return{directory:root,envFile,appPort:Number(read("POLYNOVEA_APP_PORT")||3210),supabasePort:Number(read("POLYNOVEA_SUPABASE_PORT")||54321)};
}

async function composeArgs(config:LocalRuntimeConfig,args:string[]){return ["compose","--env-file",config.envFile,"-f",composeFile,...args];}
async function docker(config:LocalRuntimeConfig,args:string[]){try{const result=await execFileAsync("docker",await composeArgs(config,args),{cwd:process.cwd(),windowsHide:true,maxBuffer:10*1024*1024});return{stdout:result.stdout.trim(),stderr:result.stderr.trim()};}catch(error:any){const message=error?.stderr||error?.message||"Docker command failed";throw Object.assign(new Error(String(message).trim()),{status:503});}}

export async function localRuntimeAction(params:{action:"start"|"stop"|"status"|"upgrade";directory?:string|null}){const config=await initializeLocalRuntime(params.directory);if(params.action==="start"){const result=await docker(config,["up","-d","--build"]);return{action:"start",config,safeOutput:result.stderr||result.stdout||"Local runtime started."};}if(params.action==="stop"){const result=await docker(config,["down"]);return{action:"stop",config,safeOutput:result.stderr||result.stdout||"Local runtime stopped."};}if(params.action==="upgrade"){const pull=await docker(config,["pull"]);const up=await docker(config,["up","-d","--build"]);return{action:"upgrade",config,safeOutput:[pull.stdout,pull.stderr,up.stdout,up.stderr].filter(Boolean).join("\n")||"Local runtime upgraded."};}const status=await docker(config,["ps","--format","json"]);let services:unknown=status.stdout;try{services=status.stdout.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}catch{}return{action:"status",config,services};}

export async function backupLocalRuntime(directory?:string|null){const config=await initializeLocalRuntime(directory);const stamp=new Date().toISOString().replace(/[:.]/g,"-");const file=path.join(config.directory,"backups",`polynovea-${stamp}.sql`);await new Promise<void>(async(resolve,reject)=>{const args=await composeArgs(config,["exec","-T","db","pg_dump","-U","postgres","-d","postgres","--no-owner","--no-privileges"]);const child=spawn("docker",args,{cwd:process.cwd(),windowsHide:true,stdio:["ignore","pipe","pipe"]});const chunks:Buffer[]=[];const errors:Buffer[]=[];child.stdout.on("data",c=>chunks.push(Buffer.from(c)));child.stderr.on("data",c=>errors.push(Buffer.from(c)));child.on("error",reject);child.on("close",async code=>{if(code!==0)return reject(new Error(Buffer.concat(errors).toString("utf8")||`pg_dump exited ${code}`));await writeFile(file,Buffer.concat(chunks),{mode:0o600});resolve();});});return{file,directory:config.directory,createdAt:new Date().toISOString()};}

export async function restoreLocalRuntime(params:{directory?:string|null;backupFile:string}){const config=await initializeLocalRuntime(params.directory);const backupFile=path.resolve(params.backupFile);if(!backupFile.startsWith(path.resolve(config.directory,"backups")))throw new Error("Restore file must be inside the local workspace backups directory");const bytes=await readFile(backupFile);await new Promise<void>(async(resolve,reject)=>{const args=await composeArgs(config,["exec","-T","db","psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1"]);const child=spawn("docker",args,{cwd:process.cwd(),windowsHide:true,stdio:["pipe","ignore","pipe"]});const errors:Buffer[]=[];child.stderr.on("data",c=>errors.push(Buffer.from(c)));child.on("error",reject);child.on("close",code=>code===0?resolve():reject(new Error(Buffer.concat(errors).toString("utf8")||`psql exited ${code}`)));child.stdin.end(bytes);});return{restored:true,backupFile};}
