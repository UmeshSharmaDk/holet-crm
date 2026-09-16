import type { Store, Options, ClientRateLimitInfo } from "express-rate-limit";
import { db, rateLimitsTable } from "@workspace/db";
import { eq, lt, sql } from "drizzle-orm";

/**
 * A rate-limit store backed by the database, so counters are shared across
 * processes and survive a restart.
 *
 * The default store keeps counts in process memory. That is fine for crude
 * flood protection, but it quietly weakens anything security-relevant: a
 * restart clears the login throttle, and on more than one instance each keeps
 * its own budget, so the effective limit is N times what is configured and an
 * attacker who reconnects may land somewhere with a fresh allowance.
 *
 * Every counter costs a query, so this is applied to the limiters where the
 * guarantee matters — login, uploads, AI — rather than to the global limiter
 * on every request. See app.ts for that reasoning.
 */
export class PostgresRateLimitStore implements Store {
  /** Counters are shared, so express-rate-limit must not also track them locally. */
  localKeys = false;

  private windowMs = 60_000;
  private readonly keyPrefix: string;
  private lastSweep = 0;

  constructor(prefix: string) {
    this.keyPrefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private scoped(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  /**
   * One statement, so concurrent requests cannot interleave between reading and
   * writing a counter. The CASE arms restart the window when the stored one has
   * already expired, which is what makes a lazily-swept table safe.
   */
  async increment(key: string): Promise<ClientRateLimitInfo> {
    const scopedKey = this.scoped(key);
    const resetTime = new Date(Date.now() + this.windowMs);

    const result = await db.execute<{ hits: number; reset_time: Date }>(sql`
      INSERT INTO rate_limits (key, hits, reset_time)
      VALUES (${scopedKey}, 1, ${resetTime.toISOString()})
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE
          WHEN rate_limits.reset_time <= now() THEN 1
          ELSE rate_limits.hits + 1
        END,
        reset_time = CASE
          WHEN rate_limits.reset_time <= now() THEN ${resetTime.toISOString()}
          ELSE rate_limits.reset_time
        END
      RETURNING hits, reset_time
    `);

    const row = (result as any).rows?.[0] ?? (result as any)[0];
    void this.sweep();

    return {
      totalHits: Number(row?.hits ?? 1),
      resetTime: row?.reset_time ? new Date(row.reset_time) : resetTime,
    };
  }

  async decrement(key: string): Promise<void> {
    await db
      .update(rateLimitsTable)
      .set({ hits: sql`GREATEST(${rateLimitsTable.hits} - 1, 0)` })
      .where(eq(rateLimitsTable.key, this.scoped(key)));
  }

  async resetKey(key: string): Promise<void> {
    await db.delete(rateLimitsTable).where(eq(rateLimitsTable.key, this.scoped(key)));
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const [row] = await db
      .select()
      .from(rateLimitsTable)
      .where(eq(rateLimitsTable.key, this.scoped(key)));
    if (!row) return undefined;
    // An expired window reads as no hits rather than a stale count.
    if (row.resetTime.getTime() <= Date.now()) return undefined;
    return { totalHits: row.hits, resetTime: row.resetTime };
  }

  /**
   * Expired rows are harmless — increment restarts the window regardless — so
   * they are cleared opportunistically rather than on a timer, which would keep
   * a handle alive and complicate shutdown.
   */
  private async sweep(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    try {
      await db.delete(rateLimitsTable).where(lt(rateLimitsTable.resetTime, new Date()));
    } catch (error) {
      console.error("[rate-limit] sweep failed", error);
    }
  }
}
