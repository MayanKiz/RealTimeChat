import { neon } from "@neondatabase/serverless";

let sqlClient;
export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured. Add Neon PostgreSQL to the Vercel project.");
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}
export function requireEnv(name) { if (!process.env[name]) throw new Error(`${name} is not configured.`); return process.env[name]; }
