import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { rotateConnectionCredential } from "@/lib/infrastructure/connectionService";

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  const auth=await requirePlatformAccess(req,{permission:"secret.manage"});if(auth.error)return auth.error;
  const {id}=await params;try{const body=await req.json();const data=await rotateConnectionCredential({workspaceId:auth.data!.actor.workspaceId,actorId:auth.data!.actor.adminUserId,connectionId:id,purpose:String(body.purpose||""),value:body.value===undefined?null:String(body.value),locator:body.locator===undefined?null:String(body.locator),approvalRequestId:body.approvalRequestId?String(body.approvalRequestId):null});return NextResponse.json({success:true,data,error:null});}
  catch(error){const status=typeof (error as {status?:unknown})?.status==="number"?(error as {status:number}).status:400;return NextResponse.json({success:false,data:null,error:error instanceof Error?error.message:"Could not rotate credential"},{status});}
}
