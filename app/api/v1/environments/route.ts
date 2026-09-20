import { requireDeveloperApi } from "@/lib/developer/apiAuth";
import { apiError, apiSuccess } from "@/lib/developer/apiContract";
import { createEnvironment, listEnvironments } from "@/lib/infrastructure/environmentService";
import { logDeveloperApiMutation } from "@/lib/developer/developerAudit";

export async function GET(req:Request){
  const auth=await requireDeveloperApi(req,{scope:"environment.read"});if(auth.error)return auth.error;
  try{return apiSuccess(await listEnvironments(auth.data!.workspaceId),{requestId:auth.data!.requestId,rateLimit:auth.data!.rateLimit});}
  catch(error){return apiError("ENVIRONMENT_LIST_FAILED",error instanceof Error?error.message:"Could not list environments",500,{requestId:auth.data!.requestId,rateLimit:auth.data!.rateLimit});}
}

export async function POST(req:Request){
  const auth=await requireDeveloperApi(req,{scope:"environment.write",requireActor:true});if(auth.error)return auth.error;
  try{const body=await req.json();const result=await createEnvironment({workspaceId:auth.data!.workspaceId,actorId:auth.data!.actorAdminUserId!,key:String(body.key||""),name:String(body.name||""),kind:body.kind,isDefault:Boolean(body.isDefault),cmsBaseUrl:body.cmsBaseUrl??null,publicSiteUrls:body.publicSiteUrls,databaseProvider:body.databaseProvider??null,storageProvider:body.storageProvider??null,runtimeProvider:body.runtimeProvider??null,secretProviderKind:body.secretProviderKind});const envId=(result as any)?.environment?.id;await logDeveloperApiMutation(auth.data!,"developer.environment.created","workspace_environment",String(envId||"unknown"),{key:body.key,kind:body.kind});return apiSuccess(result,{status:201,requestId:auth.data!.requestId,rateLimit:auth.data!.rateLimit});}
  catch(error:any){return apiError("ENVIRONMENT_CREATE_FAILED",error instanceof Error?error.message:"Could not create environment",Number(error?.status)||400,{requestId:auth.data!.requestId,rateLimit:auth.data!.rateLimit});}
}
