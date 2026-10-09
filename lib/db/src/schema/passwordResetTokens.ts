import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Single-use, short-lived tokens for the self-service "forgot password" flow.
 *
 * Only a hash of the token is stored, the same reasoning as passwordHash on
 * users: anyone who can read this table must not be able to use a row to
 * reset the account. Unlike a password, the raw value is a random 256-bit
 * string rather than something a person chose, so a fast hash (sha256, done
 * where this is read) is enough — bcrypt's deliberate slowness defends
 * against guessing a low-entropy secret, which this isn't.
 *
 * Cascades on user deletion, unlike audit_log: this is a live credential
 * grant, not a historical record that has to outlive the account.
 */
export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("password_reset_tokens_user_id_idx").on(table.userId),
    index("password_reset_tokens_expires_at_idx").on(table.expiresAt),
  ],
);

export type PasswordResetTokenRow = typeof passwordResetTokensTable.$inferSelect;
