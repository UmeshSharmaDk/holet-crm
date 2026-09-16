import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Rate-limit counters, shared across processes.
 *
 * express-rate-limit's default store lives in the process, so counters reset on
 * restart and each instance keeps its own. For a login throttle that means the
 * real budget is N x the configured value on a multi-instance deploy, and a
 * restart hands an attacker a fresh one — exactly the guarantee the throttle is
 * supposed to provide.
 */
export const rateLimitsTable = pgTable(
  "rate_limits",
  {
    // Prefixed per limiter, so the login and upload budgets cannot collide.
    key: text("key").primaryKey(),
    hits: integer("hits").notNull().default(0),
    resetTime: timestamp("reset_time", { withTimezone: true }).notNull(),
  },
  (table) => [index("rate_limits_reset_time_idx").on(table.resetTime)],
);

export type RateLimitRow = typeof rateLimitsTable.$inferSelect;
