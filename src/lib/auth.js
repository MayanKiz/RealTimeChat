import { cookies } from "next/headers";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db";
const scrypt = promisify(scryptCallback);
const COOKIE = "rtc_session";
const DAY = 86400000;
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
async function hashPassword(password, salt = randomBytes(16).toString("hex")) { const derived = await scrypt(password, salt, 64); return `${salt}:${derived.toString("hex")}`; }
async function verifyPassword(password, stored) { const [salt, hex] = String(stored || "").split(":"); if (!salt || !hex) return false; const actual = Buffer.from((await scrypt(password,salt,64)).toString("hex"),"hex"); const expected=Buffer.from(hex,"hex"); return actual.length===expected.length && timingSafeEqual(actual,expected); }
export async function register(email,password) { const normalized=email.trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error("Enter a valid email address."); if (!password || password.length<10) throw new Error("Use a password with at least 10 characters."); const sql=db(); const passwordHash=await hashPassword(password); const rows=await sql`insert into users(email,password_hash) values(${normalized},${passwordHash}) on conflict(email) do nothing returning id,email`; if (!rows[0]) throw new Error("An account with that email already exists."); return createSession(rows[0]); }
export async function login(email,password) { const sql=db(); const rows=await sql`select id,email,password_hash from users where email=${email.trim().toLowerCase()} limit 1`; if (!rows[0] || !(await verifyPassword(password,rows[0].password_hash))) throw new Error("Invalid email or password."); return createSession(rows[0]); }
async function createSession(user) { const token=randomBytes(32).toString("base64url"); const sql=db(); await sql`insert into sessions(token_hash,user_id,expires_at) values(${hashToken(token)},${user.id},now()+interval '30 days')`; (await cookies()).set(COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:30*DAY/1000}); return {id:user.id,email:user.email,display_name:user.display_name,contact_code:user.contact_code}; }
export { createSession as createSessionForUser };
export async function currentUser() { const token=(await cookies()).get(COOKIE)?.value; if (!token) return null; const sql=db(); const rows=await sql`select u.id,u.email,u.display_name,u.contact_code from sessions s join users u on u.id=s.user_id where s.token_hash=${hashToken(token)} and s.expires_at>now() limit 1`; return rows[0] || null; }
export async function requireUser() { const user=await currentUser(); if (!user) { const error=new Error("Authentication required"); error.status=401; throw error; } return user; }
export async function logout() { const token=(await cookies()).get(COOKIE)?.value; if (token) { const sql=db(); await sql`delete from sessions where token_hash=${hashToken(token)}`; } (await cookies()).delete(COOKIE); }
export function jsonError(error) { const status=error.status || 400; return Response.json({error:error.message || "Request failed"},{status}); }
