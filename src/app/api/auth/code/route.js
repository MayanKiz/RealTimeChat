import { createSessionForUser, jsonError } from "../../../../lib/auth";
import { db } from "../../../../lib/db";

export async function POST(request) {
  try {
    const { name, code } = await request.json();
    const displayName = String(name || "").trim().slice(0, 40);
    const contactCode = String(code || "").trim();
    if (displayName.length < 1) throw new Error("Write your name first.");
    if (!/^\d{6}$/.test(contactCode)) throw new Error("Use exactly 6 digits.");
    const sql = db();
    const existing = await sql`select id,email,display_name,contact_code from users where contact_code=${contactCode} limit 1`;
    let user = existing[0];
    if (user) {
      const updated = await sql`update users set display_name=${displayName} where id=${user.id} returning id,email,display_name,contact_code`;
      user = updated[0];
    } else {
      const email = `${contactCode}@naazz.local`;
      const created = await sql`insert into users(email,display_name,contact_code) values(${email},${displayName},${contactCode}) returning id,email,display_name,contact_code`;
      user = created[0];
    }
    return Response.json({ user: await createSessionForUser(user) });
  } catch (error) {
    return jsonError(error);
  }
}
