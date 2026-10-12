import fs from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
const connectionString = process.env.DATABASE_URL || process.env.STORAGE_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const sql = neon(connectionString);
await sql`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
const dir = path.resolve("db/migrations");
for (const file of (await fs.readdir(dir)).filter((x)=>x.endsWith(".sql")).sort()) {
  const [{count}] = await sql`select count(*)::int as count from schema_migrations where version=${file}`;
  if (count) continue;
  const content = await fs.readFile(path.join(dir,file), "utf8");
  const statements = content.split(";").map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) await sql.query(statement);
  await sql`insert into schema_migrations(version) values(${file})`;
  console.log(`Applied ${file}`);
}
