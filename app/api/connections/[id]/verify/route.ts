import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { verifyConnection } from "@/lib/infrastructure/connectionService";

// Phase 12.5 Connection Verification Route
export const dynamic = "force-dynamic";

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  const auth=await requirePlatformAccess(req,{permission:"connection.verify"});if(auth.error)return auth.error;
  const {id}=await params;try{const data=await verifyConnection({workspaceId:auth.data!.actor.workspaceId,actorId:auth.data!.actor.adminUserId,connectionId:id});return NextResponse.json({success:true,data,error:null});}
  catch(error){const status=typeof (error as {status?:unknown})?.status==="number"?(error as {status:number}).status:400;return NextResponse.json({success:false,data:null,error:error instanceof Error?error.message:"Connection verification failed"},{status});}
}
