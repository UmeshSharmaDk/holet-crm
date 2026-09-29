import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Tracks spent AI action-confirmation tokens so a signed write proposal
 * (create_booking/update_booking) can be applied at most once.
 *
 * The token's HMAC signature and expiry alone don't stop replay: the same
 * still-valid token could be POSTed twice within its 10-minute TTL — a
 * client retry, a double-tap — and create or update the same record again.
 * Inserting the token's jti here, and treating a unique-constraint failure
 * as "already used", makes consumption atomic without a transaction.
 */
export const consumedActionTokensTable = pgTable(
  "consumed_action_tokens",
  {
    jti: text("jti").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("consumed_action_tokens_expires_at_idx").on(table.expiresAt)],
);

export type ConsumedActionTokenRow = typeof consumedActionTokensTable.$inferSelect;
