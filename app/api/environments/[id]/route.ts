import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getEnvironment, updateEnvironment } from "@/lib/infrastructure/environmentService";

export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
  const auth=await requirePlatformAccess(req,{permission:"environment.read"});if(auth.error)return auth.error;
  const {id}=await params;try{const data=await getEnvironment(auth.data!.actor.workspaceId,id);if(!data)return NextResponse.json({success:false,data:null,error:"Environment not found"},{status:404});return NextResponse.json({success:true,data,error:null});}
  catch(error){return NextResponse.json({success:false,data:null,error:error instanceof Error?error.message:"Could not load environment"},{status:500});}
}

export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){
  const auth=await requirePlatformAccess(req,{permission:"environment.manage"});if(auth.error)return auth.error;
  const {id}=await params;try{const current=await getEnvironment(auth.data!.actor.workspaceId,id);if(!current)return NextResponse.json({success:false,data:null,error:"Environment not found"},{status:404});const body=await req.json();const data=await updateEnvironment({workspaceId:auth.data!.actor.workspaceId,actorId:auth.data!.actor.adminUserId,environmentId:id,name:body.name===undefined?current.name:String(body.name),status:body.status===undefined?current.status:body.status,isDefault:body.isDefault===undefined?current.is_default:Boolean(body.isDefault),cmsBaseUrl:body.cmsBaseUrl===undefined?current.cms_base_url:body.cmsBaseUrl?String(body.cmsBaseUrl):null,publicSiteUrls:body.publicSiteUrls===undefined?current.public_site_urls:body.publicSiteUrls,databaseProvider:body.databaseProvider===undefined?current.database_provider:body.databaseProvider?String(body.databaseProvider):null,storageProvider:body.storageProvider===undefined?current.storage_provider:body.storageProvider?String(body.storageProvider):null,runtimeProvider:body.runtimeProvider===undefined?current.runtime_provider:body.runtimeProvider?String(body.runtimeProvider):null,config:body.config===undefined?current.config_json:body.config});return NextResponse.json({success:true,data,error:null});}
  catch(error){const status=typeof (error as {status?:unknown})?.status==="number"?(error as {status:number}).status:400;return NextResponse.json({success:false,data:null,error:error instanceof Error?error.message:"Could not update environment"},{status});}
}
