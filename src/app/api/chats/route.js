import { requireUser, jsonError } from "../../../lib/auth";
import { db } from "../../../lib/db";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db()`select c.id,c.created_at,u.id as contact_id,u.display_name as contact_name,u.contact_code from conversations c join conversation_members mine on mine.conversation_id=c.id and mine.user_id=${user.id} join conversation_members other_member on other_member.conversation_id=c.id and other_member.user_id<>${user.id} join users u on u.id=other_member.user_id order by c.created_at desc`;
    return Response.json({ chats: rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request) {
  try {
    const user = await requireUser();
    const { code } = await request.json();
    const contactCode = String(code || "").trim();
    if (!/^\d{6}$/.test(contactCode)) throw new Error("Enter a valid 6-digit code.");
    const sql = db();
    const targetRows = await sql`select id,display_name,contact_code from users where contact_code=${contactCode} limit 1`;
    const target = targetRows[0];
    if (!target) throw new Error("No one is using that code yet.");
    if (target.id === user.id) throw new Error("Use someone else's code to start a chat.");
    const existing = await sql`select c.id from conversations c join conversation_members mine on mine.conversation_id=c.id and mine.user_id=${user.id} join conversation_members other_member on other_member.conversation_id=c.id and other_member.user_id=${target.id} limit 1`;
    if (existing[0]) return Response.json({ chat: { id: existing[0].id } });
    const title = target.display_name || "New chat";
    const created = await sql`insert into conversations(title,created_by) values(${title},${user.id}) returning id`;
    await sql`insert into conversation_members(conversation_id,user_id,role) values(${created[0].id},${user.id},'owner'),(${created[0].id},${target.id},'member')`;
    return Response.json({ chat: { id: created[0].id, contact_id: target.id, contact_name: title, contact_code: target.contact_code } }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
