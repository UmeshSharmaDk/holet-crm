import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Append-only record of access to sensitive data and of destructive actions.
 *
 * Access control answers who *may* act; this answers who *did*. For a platform
 * storing photographs of government identity documents that is the difference
 * between "we believe only staff of that hotel could see it" and being able to
 * say which account opened a particular guest's ID, and when.
 *
 * Deliberately free of foreign keys. An audit row has to outlive the records it
 * describes — deleting a user or a hotel must not take the evidence with it —
 * so the actor's email is denormalised rather than joined.
 */
export const auditLogTable = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    actorUserId: integer("actor_user_id"),
    /** Kept verbatim so the trail stays readable after the account is gone. */
    actorEmail: text("actor_email").notNull(),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: integer("target_id"),
    hotelId: integer("hotel_id"),
    /**
     * Small, non-sensitive context — counts, which field changed, which side of
     * an ID was read. Never document contents, and never a credential.
     */
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_created_at_idx").on(table.createdAt),
    index("audit_log_actor_idx").on(table.actorUserId),
    index("audit_log_target_idx").on(table.targetType, table.targetId),
  ],
);

export type AuditLogRow = typeof auditLogTable.$inferSelect;
