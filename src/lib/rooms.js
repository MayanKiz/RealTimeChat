import { db } from "./db";
export async function member(userId, roomId) { const rows=await db()`select c.id,c.title,cm.role from conversations c join conversation_members cm on cm.conversation_id=c.id where c.id=${roomId} and cm.user_id=${userId} limit 1`; if(!rows[0]){const e=new Error("Conversation not found or access denied.");e.status=403;throw e;} return rows[0]; }
export function validUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||"");}
