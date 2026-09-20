import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { runSiteDiscoverabilityAudit } from "@/lib/content/webQualityService";
export async function GET(req:Request){const auth=await requirePlatformAccess(req,{permission:"content.entry.read"});if(auth.error)return auth.error;try{return NextResponse.json({success:true,data:await runSiteDiscoverabilityAudit(auth.data!.actor.workspaceId),error:null,timestamp:new Date().toISOString()});}catch(e){return NextResponse.json({success:false,data:null,error:e instanceof Error?e.message:"Could not run Web Quality audit",timestamp:new Date().toISOString()},{status:500});}}
