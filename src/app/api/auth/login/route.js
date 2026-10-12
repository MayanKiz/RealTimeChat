import { login, jsonError } from "../../../../lib/auth";
export async function POST(request){try{const {email,password}=await request.json();return Response.json({user:await login(email||"",password||"")});}catch(e){return jsonError(e);}}
