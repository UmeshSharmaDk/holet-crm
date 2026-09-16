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

/**
 * TLS for the database connection.
 *
 * Certificate verification is ON by default: encryption without authentication
 * leaves the connection open to an active man-in-the-middle, who can present a
 * self-signed certificate and read or rewrite every query.
 *
 * Providers that use a private CA should supply it via DATABASE_CA_CERT (PEM).
 * DATABASE_SSL_REJECT_UNAUTHORIZED=false exists only as a deliberate, loudly
 * logged escape hatch — it must never be the default.
 */
function buildSslConfig(): pg.PoolConfig["ssl"] {
  const sslEnabled = isProduction || process.env.DATABASE_SSL === "true";
  if (!sslEnabled) return false;

  const rejectUnauthorized =
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false";

  if (!rejectUnauthorized) {
    console.warn(
      "[db] DATABASE_SSL_REJECT_UNAUTHORIZED=false — the database certificate is NOT verified. " +
        "This connection can be intercepted. Supply DATABASE_CA_CERT and remove this override.",
    );
  }

  const ca = process.env.DATABASE_CA_CERT;
  return ca ? { ca, rejectUnauthorized } : { rejectUnauthorized };
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: buildSslConfig(),
  max: 20, // Enforce a connection pool limit
  idleTimeoutMillis: 30000,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
