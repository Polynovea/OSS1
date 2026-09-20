import { requireDeveloperApi } from "@/lib/developer/apiAuth";
import { apiSuccess } from "@/lib/developer/apiContract";
import { exportSchemaBundle } from "@/lib/developer/schemaDeliveryService";

export async function GET(req:Request){const auth=await requireDeveloperApi(req,{scope:"schema.read"});if(auth.error)return auth.error;const url=new URL(req.url);const bundle=await exportSchemaBundle(auth.data!.workspaceId,url.searchParams.get("environment"));if(auth.data!.allowedModels.length)bundle.models=bundle.models.filter(m=>auth.data!.allowedModels.includes(m.apiKey));return apiSuccess(bundle,{requestId:auth.data!.requestId,rateLimit:auth.data!.rateLimit});}
