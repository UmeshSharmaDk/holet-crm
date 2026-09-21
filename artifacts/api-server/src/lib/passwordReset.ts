import crypto from "node:crypto";
import { db, passwordResetTokensTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";

const TOKEN_TTL_MS = Number(process.env["PASSWORD_RESET_TOKEN_TTL_MINUTES"] ?? 60) * 60_000;

export function hashResetToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

let lastSweep = 0;

/** Expired rows are harmless to read (checked against expiresAt too), so this is opportunistic rather than scheduled. */
async function sweepExpiredTokens(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  try {
    await db.delete(passwordResetTokensTable).where(lt(passwordResetTokensTable.expiresAt, new Date()));
  } catch (error) {
    console.error("[password-reset] sweep failed", error);
  }
}

/**
 * Mints a single-use reset token for a user and stores only its hash.
 *
 * Exported as a seam for tests: the raw token is never persisted anywhere
 * (only its hash is), so a test that exercises the reset endpoint has to
 * obtain a raw token the same way the real flow does — by calling this
 * directly — rather than by reading it back out of the database, which is
 * exactly what an attacker who compromised the table would also be unable
 * to do.
 */
export async function createPasswordResetToken(userId: number): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  // Only the most recently requested link should work — otherwise an older
  // email sitting in an inbox stays valid after a newer one was issued.
  await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, userId));
  await db.insert(passwordResetTokensTable).values({ userId, tokenHash, expiresAt });

  void sweepExpiredTokens();
  return rawToken;
}

/**
 * Verifies and consumes a reset token, returning the user id it was issued
 * for, or null if it is missing, already used, or expired.
 *
 * Every outstanding token for the account is deleted on a successful
 * lookup — not just the one presented — so the token is single-use even if
 * the reset email was opened in two tabs.
 */
export async function consumePasswordResetToken(rawToken: string): Promise<number | null> {
  const tokenHash = hashResetToken(rawToken);
  const [row] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.tokenHash, tokenHash));

  if (!row || row.expiresAt.getTime() <= Date.now()) return null;

  await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, row.userId));
  return row.userId;
}
