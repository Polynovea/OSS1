import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { getModel, getVersion, listModels } from "@/lib/schema/modelService";
import { getEntry, listEntryVersions } from "@/lib/content/entryService";

export async function getModelByApiKey(workspaceId:string,apiKey:string){return (await listModels(workspaceId)).find(m=>m.api_key===apiKey)??null;}
export async function getEntryDeveloperView(workspaceId:string,entryId:string){
  const entry=await getEntry(workspaceId,entryId);if(!entry)return null;
  const model=await getModel(workspaceId,entry.content_model_id);if(!model)return null;
  const versions=await listEntryVersions(entry.id);
  return {entry,model:{id:model.id,apiKey:model.api_key,name:model.name,currentSchemaVersion:model.current_schema_version,capability:model.settings_json?.capability??"publishable"},versions};
}
export async function listDeveloperEntries(params:{workspaceId:string;modelApiKey?:string;status?:string;locale?:string;limit?:number;offset?:number}){
  const db=createServiceRoleClient();const limit=Math.min(200,Math.max(1,params.limit??50)),offset=Math.max(0,params.offset??0);let modelId:string|undefined;
  if(params.modelApiKey){const model=await getModelByApiKey(params.workspaceId,params.modelApiKey);if(!model)return {rows:[],model:null,limit,offset};modelId=model.id;}
  let query=db.from("content_entries").select("*").eq("workspace_id",params.workspaceId).order("updated_at",{ascending:false});if(modelId)query=query.eq("content_model_id",modelId);if(params.status)query=query.eq("status",params.status);
  const {data,error}=await query.range(offset,offset+limit-1);if(error)throw new Error(error.message);const entries=data??[];const versionIds=[...new Set(entries.flatMap((e:any)=>[e.current_draft_version_id,e.published_version_id].filter(Boolean)))];
  const {data:versions}=versionIds.length?await db.from("content_entry_versions").select("id,entry_id,version_number,data_jsonb,locale,state,model_schema_version,created_at,change_summary").in("id",versionIds):{data:[] as any[]};const versionById=new Map((versions??[]).map((v:any)=>[v.id,v]));
  const filtered=entries.map((entry:any)=>{const current=entry.current_draft_version_id?versionById.get(entry.current_draft_version_id):entry.published_version_id?versionById.get(entry.published_version_id):null;return {...entry,currentVersion:current??null};}).filter((entry:any)=>!params.locale||entry.currentVersion?.locale===params.locale);
  return {rows:filtered,model:modelId?await getModel(params.workspaceId,modelId):null,limit,offset};
}
export async function getModelContract(workspaceId:string,apiKey:string){const model=await getModelByApiKey(workspaceId,apiKey);if(!model)return null;const version=await getVersion(model.id,model.current_schema_version);return version?{model,version}:null;}
