import { currentUser, jsonError } from "../../../../lib/auth";
export async function GET(){try{return Response.json({user:await currentUser()});}catch(e){return jsonError(e);}}
