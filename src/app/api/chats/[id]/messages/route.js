import { requireUser, jsonError } from "../../../../../lib/auth";
import { db } from "../../../../../lib/db";
import { member } from "../../../../../lib/rooms";

export async function GET(request, { params }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await member(user.id, id);
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const limit = Math.min(Number(url.searchParams.get("limit") || 100), 200);
    const rows = cursor
      ? await db()`select id,conversation_id,user_id,body,created_at from messages where conversation_id=${id} and (created_at,id)>((select created_at from messages where id=${cursor}),${cursor}) order by created_at,id limit ${limit}`
      : await db()`select id,conversation_id,user_id,body,created_at from messages where conversation_id=${id} order by created_at,id limit ${limit}`;
    return Response.json({ messages: rows, nextCursor: rows.at(-1)?.id || cursor || null });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request, { params }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await member(user.id, id);
    const { body } = await request.json();
    const text = String(body || "").trim();
    if (!text || text.length > 4000) throw new Error("Message must be between 1 and 4000 characters.");
    const rows = await db()`insert into messages(conversation_id,user_id,body) values(${id},${user.id},${text}) returning id,conversation_id,user_id,body,created_at`;
    return Response.json({ message: rows[0] }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
