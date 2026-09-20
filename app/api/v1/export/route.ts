import { requireDeveloperApi } from "@/lib/developer/apiAuth";
import { apiError, apiSuccess } from "@/lib/developer/apiContract";
import { exportWorkspaceData } from "@/lib/developer/exportService";

export async function GET(req:Request){const auth=await requireDeveloperApi(req,{scope:["content.read","schema.read","media.read","releases.read"]});if(auth.error)return auth.error;if(auth.data!.allowedModels.length)return apiError("MODEL_RESTRICTED","Full workspace export requires a token without model restrictions",403,{requestId:auth.data!.requestId,rateLimit:auth.data!.rateLimit});try{return apiSuccess(await exportWorkspaceData(auth.data!.workspaceId),{requestId:auth.data!.requestId,rateLimit:auth.data!.rateLimit});}catch(e){return apiError("EXPORT_FAILED",e instanceof Error?e.message:"Could not export workspace",500,{requestId:auth.data!.requestId,rateLimit:auth.data!.rateLimit});}}
