import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getConnectorCatalog } from "@/lib/infrastructure/connectionService";

export async function GET(req:Request){const auth=await requirePlatformAccess(req,{permission:"connection.read"});if(auth.error)return auth.error;return NextResponse.json({success:true,data:getConnectorCatalog(),error:null});}
