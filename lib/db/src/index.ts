import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "FATAL: DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const isProduction = process.env.NODE_ENV === "production";

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 20, // Enforce a connection pool limit
  idleTimeoutMillis: 30000,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
