import { config as loadEnv } from "dotenv";
import { Pool, types } from "pg";

loadEnv();

types.setTypeParser(20, (value) => Number.parseInt(value, 10));

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to create the database pool");
}

export const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
});

export async function closePool(): Promise<void> {
  await pool.end();
}
