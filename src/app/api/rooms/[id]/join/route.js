import { requireUser, jsonError } from "../../../../../lib/auth";
import { db } from "../../../../../lib/db";
export async function POST(_request,{params}){try{const u=await requireUser();const {id}=await params;const found=await db()`select id from conversations where id=${id} limit 1`;if(!found[0])throw new Error("Room not found.");await db()`insert into conversation_members(conversation_id,user_id) values(${id},${u.id}) on conflict do nothing`;return Response.json({roomId:id});}catch(e){return jsonError(e);}}
