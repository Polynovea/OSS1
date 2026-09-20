import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { createEnvironment, listEnvironments } from "@/lib/infrastructure/environmentService";

export async function GET(req:Request){
  const auth=await requirePlatformAccess(req,{permission:"environment.read"});if(auth.error)return auth.error;
  try{return NextResponse.json({success:true,data:await listEnvironments(auth.data!.actor.workspaceId),error:null});}
  catch(error){return NextResponse.json({success:false,data:null,error:error instanceof Error?error.message:"Could not load environments"},{status:500});}
}

export async function POST(req:Request){
  const auth=await requirePlatformAccess(req,{permission:"environment.manage"});if(auth.error)return auth.error;
  try{const body=await req.json();const data=await createEnvironment({workspaceId:auth.data!.actor.workspaceId,actorId:auth.data!.actor.adminUserId,key:String(body.key||""),name:String(body.name||""),kind:body.kind,isDefault:Boolean(body.isDefault),cmsBaseUrl:body.cmsBaseUrl?String(body.cmsBaseUrl):null,publicSiteUrls:body.publicSiteUrls,databaseProvider:body.databaseProvider?String(body.databaseProvider):null,storageProvider:body.storageProvider?String(body.storageProvider):null,runtimeProvider:body.runtimeProvider?String(body.runtimeProvider):null,secretProviderKind:body.secretProviderKind});return NextResponse.json({success:true,data,error:null},{status:201});}
  catch(error){const status=typeof (error as {status?:unknown})?.status==="number"?(error as {status:number}).status:400;return NextResponse.json({success:false,data:null,error:error instanceof Error?error.message:"Could not create environment"},{status});}
}
