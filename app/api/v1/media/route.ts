import { requireDeveloperApi } from "@/lib/developer/apiAuth";
import { apiError, apiSuccess } from "@/lib/developer/apiContract";
import { listAssets, registerUpload } from "@/lib/media/assetService";
import { logDeveloperApiMutation } from "@/lib/developer/developerAudit";
import { getStorageProvider } from "@/lib/media/storageProvider";

export async function GET(req:Request){
  const auth=await requireDeveloperApi(req,{scope:"media.read"});if(auth.error)return auth.error;
  const workspaceId=auth.data!.workspaceId;
  const assets=await listAssets(workspaceId);
  const data=await Promise.all(assets.map(async asset=>{
    try{const provider=await getStorageProvider({workspaceId,storageProviderKey:asset.storage_provider});return{...asset,read_url:await provider.resolveReadUrl(asset.storage_key),storage_status:"available"};}
    catch(error){return{...asset,read_url:null,storage_status:"unavailable",storage_error:error instanceof Error?error.message:"Storage provider unavailable"};}
  }));
  return apiSuccess(data,{requestId:auth.data!.requestId,rateLimit:auth.data!.rateLimit});
}

export async function POST(req:Request){
  const auth=await requireDeveloperApi(req,{scope:"media.write",requireActor:true});if(auth.error)return auth.error;
  try{
    const form=await req.formData();const file=form.get("file");
    if(!(file instanceof File))return apiError("FILE_REQUIRED","multipart field 'file' is required",400,{requestId:auth.data!.requestId,rateLimit:auth.data!.rateLimit});
    const result=await registerUpload({workspaceId:auth.data!.workspaceId,actorAdminUserId:auth.data!.actorAdminUserId!,file,folder:String(form.get("folder")||"general"),altText:String(form.get("altText")||""),caption:String(form.get("caption")||""),environmentId:form.get("environmentId")?String(form.get("environmentId")):null});
    if(!result.ok)return apiError("MEDIA_UPLOAD_FAILED",result.error,result.status,{requestId:auth.data!.requestId,rateLimit:auth.data!.rateLimit});
    await logDeveloperApiMutation(auth.data!,"developer.media.uploaded","asset",result.data.id,{filename:result.data.filename,mimeType:result.data.mime_type,storageProvider:result.data.storage_provider});
    return apiSuccess(result.data,{status:201,requestId:auth.data!.requestId,rateLimit:auth.data!.rateLimit});
  }catch(e){return apiError("MEDIA_UPLOAD_FAILED",e instanceof Error?e.message:"Could not upload media",400,{requestId:auth.data!.requestId,rateLimit:auth.data!.rateLimit});}
}
