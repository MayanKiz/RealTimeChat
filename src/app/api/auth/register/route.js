import { register, jsonError } from "../../../../lib/auth";
export async function POST(request){try{const {email,password}=await request.json();return Response.json({user:await register(email||"",password||"")},{status:201});}catch(e){return jsonError(e);}}
