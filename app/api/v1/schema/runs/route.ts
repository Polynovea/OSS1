import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { requireDeveloperApi } from "@/lib/developer/apiAuth";
import { apiSuccess } from "@/lib/developer/apiContract";
export async function GET(req:Request){const auth=await requireDeveloperApi(req,{scope:"schema.read"});if(auth.error)return auth.error;const {data}=await createServiceRoleClient().from("developer_schema_runs").select("id,operation,status,source_environment,target_environment,bundle_hash,summary_json,approval_note,created_at,completed_at").eq("workspace_id",auth.data!.workspaceId).order("created_at",{ascending:false}).limit(100);return apiSuccess(data??[],{requestId:auth.data!.requestId,rateLimit:auth.data!.rateLimit});}
