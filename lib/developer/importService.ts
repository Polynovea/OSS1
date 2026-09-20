import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { createEntry } from "@/lib/content/entryService";
import { validateEntryData } from "@/lib/content/entryValidation";
import { getVersion, listModels } from "@/lib/schema/modelService";
import type { DeveloperApiContext } from "@/lib/developer/apiAuth";
import { logDeveloperApiMutation } from "@/lib/developer/developerAudit";

export type ImportFormat="json"|"csv"|"markdown"|"wordpress";

type ImportInput={context:DeveloperApiContext;modelApiKey:string;format:ImportFormat;content:unknown;mapping?:Record<string,string>;locale?:string;commit?:boolean;sourceName?:string|null;continueOnError?:boolean};

function parseCsv(text:string){
  const rows:string[][]=[];let row:string[]=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell="";}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);cell="";if(row.some(v=>v!==""))rows.push(row);row=[];}else cell+=c;}
  row.push(cell);if(row.some(v=>v!==""))rows.push(row);if(rows.length<1)return [];
  const headers=rows[0].map(h=>h.trim());return rows.slice(1).map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??""])));
}
function scalar(value:string):unknown{const v=value.trim();if(v==="true")return true;if(v==="false")return false;if(v==="null")return null;if(/^-?\d+(\.\d+)?$/.test(v))return Number(v);if((v.startsWith('[')&&v.endsWith(']'))||(v.startsWith('{')&&v.endsWith('}'))){try{return JSON.parse(v);}catch{}}return v.replace(/^['"]|['"]$/g,"");}
function parseMarkdownOne(text:string){
  const normalized=text.replace(/^\uFEFF/,"");let body=normalized;const record:Record<string,unknown>={};
  if(normalized.startsWith("---\n")||normalized.startsWith("---\r\n")){const match=normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);if(match){for(const line of match[1].split(/\r?\n/)){const idx=line.indexOf(":");if(idx>0)record[line.slice(0,idx).trim()]=scalar(line.slice(idx+1));}body=normalized.slice(match[0].length);}}
  record.markdown=body.trim();record.content=body.trim();record.body=body.trim();return record;
}
function wordpressRecord(raw:any){return {id:raw?.id,title:raw?.title?.rendered??raw?.title??"",content:raw?.content?.rendered??raw?.content??"",excerpt:raw?.excerpt?.rendered??raw?.excerpt??"",slug:raw?.slug??"",date:raw?.date??null,modified:raw?.modified??null,status:raw?.status??null,link:raw?.link??null};}
function parseRecords(format:ImportFormat,content:unknown):Record<string,unknown>[] {
  if(format==="json"){const parsed=typeof content==="string"?JSON.parse(content):content;const arr=Array.isArray(parsed)?parsed:Array.isArray((parsed as any)?.items)?(parsed as any).items:[parsed];return (arr as unknown[]).filter((v:unknown)=>Boolean(v)&&typeof v==="object") as Record<string,unknown>[];}
  if(format==="csv"){if(typeof content!=="string")throw new Error("CSV import content must be a string");return parseCsv(content);}
  if(format==="markdown"){const arr=Array.isArray(content)?content:[content];if(arr.some(v=>typeof v!=="string"))throw new Error("Markdown import content must be a string or string array");return (arr as string[]).map(parseMarkdownOne);}
  const parsed=typeof content==="string"?JSON.parse(content):content;const arr=Array.isArray(parsed)?parsed:Array.isArray((parsed as any)?.posts)?(parsed as any).posts:[parsed];return arr.filter(Boolean).map(wordpressRecord);
}
function mapRecord(record:Record<string,unknown>,mapping?:Record<string,string>){if(!mapping||!Object.keys(mapping).length)return record;const out:Record<string,unknown>={};for(const [target,source] of Object.entries(mapping))out[target]=record[source];return out;}

export async function runGovernedImport(input:ImportInput){
  const {context}=input;if(input.commit&&!context.actorAdminUserId)throw new Error("Token actor identity is required for committed imports");
  const model=(await listModels(context.workspaceId)).find(m=>m.api_key===input.modelApiKey&&m.status==="active");if(!model)throw new Error("Active content model not found");
  const version=await getVersion(model.id,model.current_schema_version);if(!version)throw new Error("Current model schema not found");
  const records=parseRecords(input.format,input.content).map(r=>mapRecord(r,input.mapping));
  const validation=records.map((data,index)=>({index,data,errors:validateEntryData(version.schema_json,data)}));
  const invalid=validation.filter(r=>r.errors.length);
  const mode=input.commit?"commit":"dry_run";
  const db=createServiceRoleClient();
  const {data:run,error:runError}=await db.from("developer_import_runs").insert({workspace_id:context.workspaceId,api_token_id:context.tokenId,actor_admin_user_id:context.actorAdminUserId,content_model_id:model.id,format:input.format,mode,status:input.commit?"planned":"completed",source_name:input.sourceName??null,locale:input.locale??"en",total_rows:records.length,succeeded_rows:input.commit?0:records.length-invalid.length,failed_rows:invalid.length,errors_json:invalid.map(r=>({index:r.index,errors:r.errors})),result_json:{mapping:input.mapping??{},dryRun:!input.commit},completed_at:input.commit?null:new Date().toISOString()}).select().single();
  if(runError||!run)throw new Error(runError?.message||"Could not record import run");
  if(!input.commit){await logDeveloperApiMutation(context,"developer.import.dry_run","developer_import_run",run.id,{format:input.format,model:input.modelApiKey,total:records.length,invalid:invalid.length});return {runId:run.id,mode,model:input.modelApiKey,total:records.length,valid:records.length-invalid.length,invalid:invalid.length,rows:validation.map(r=>({index:r.index,valid:r.errors.length===0,errors:r.errors,preview:r.data}))};}
  if(invalid.length&&!input.continueOnError){await db.from("developer_import_runs").update({status:"failed",completed_at:new Date().toISOString(),result_json:{reason:"validation_failed_before_commit"}}).eq("id",run.id);return {runId:run.id,mode,committed:false,total:records.length,succeeded:0,failed:invalid.length,errors:invalid.map(r=>({index:r.index,errors:r.errors}))};}
  const results:Array<Record<string,unknown>>=[];let succeeded=0,failed=0;
  for(const row of validation){if(row.errors.length){failed++;results.push({index:row.index,status:"invalid",errors:row.errors});continue;}const created=await createEntry({workspaceId:context.workspaceId,modelId:model.id,data:row.data,locale:input.locale??"en",actorAdminUserId:context.actorAdminUserId!,changeSummary:`Imported via ${input.format}${input.sourceName?` from ${input.sourceName}`:""}`});if(created.ok){succeeded++;results.push({index:row.index,status:"created",entryId:created.data.entry.id,versionId:created.data.version.id});}else{failed++;results.push({index:row.index,status:"failed",error:created.error});if(!input.continueOnError)break;}}
  const status=failed?(succeeded?"partially_failed":"failed"):"completed";
  await db.from("developer_import_runs").update({status,succeeded_rows:succeeded,failed_rows:failed,errors_json:results.filter(r=>r.status!=="created"),result_json:{results},completed_at:new Date().toISOString()}).eq("id",run.id);
  await logDeveloperApiMutation(context,"developer.import.committed","developer_import_run",run.id,{format:input.format,model:input.modelApiKey,total:records.length,succeeded,failed,status});
  return {runId:run.id,mode,committed:status!=="failed",status,total:records.length,succeeded,failed,results};
}
