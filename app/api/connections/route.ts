import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { createConnection, listConnections } from "@/lib/infrastructure/connectionService";

export async function GET(req:Request){
  const auth=await requirePlatformAccess(req,{permission:"connection.read"});if(auth.error)return auth.error;
  try{return NextResponse.json({success:true,data:await listConnections(auth.data!.actor.workspaceId),error:null});}
  catch(error){return NextResponse.json({success:false,data:null,error:error instanceof Error?error.message:"Could not load connections"},{status:500});}
}

export async function POST(req:Request){
  const auth=await requirePlatformAccess(req,{permission:"connection.manage"});if(auth.error)return auth.error;
  try{const body=await req.json();const data=await createConnection({workspaceId:auth.data!.actor.workspaceId,actorId:auth.data!.actor.adminUserId,environmentId:String(body.environmentId||""),connectorType:String(body.connectorType||""),name:String(body.name||""),config:body.config&&typeof body.config==="object"?body.config:{},secretProviderId:body.secretProviderId?String(body.secretProviderId):null,credentials:Array.isArray(body.credentials)?body.credentials:[]});return NextResponse.json({success:true,data,error:null},{status:201});}
  catch(error){const status=typeof (error as {status?:unknown})?.status==="number"?(error as {status:number}).status:400;return NextResponse.json({success:false,data:null,error:error instanceof Error?error.message:"Could not create connection"},{status});}
}
