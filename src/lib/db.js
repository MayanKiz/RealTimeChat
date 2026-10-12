import { neon } from "@neondatabase/serverless";

let sqlClient;
export function db() {
  const connectionString = process.env.DATABASE_URL || process.env.STORAGE_DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured. Add Neon PostgreSQL to the Vercel project.");
  if (!sqlClient) sqlClient = neon(connectionString);
  return sqlClient;
}
export function requireEnv(name) { if (!process.env[name]) throw new Error(`${name} is not configured.`); return process.env[name]; }
