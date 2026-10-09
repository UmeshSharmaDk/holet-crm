import type { Request } from "express";
import { db, auditLogTable } from "@workspace/db";

/**
 * The actions worth being able to answer questions about later: who read a
 * guest's identity document, and who destroyed something that cannot be
 * recovered.
 */
export type AuditAction =
  | "guest_id_scan.read"
  | "guest_roster.write"
  | "booking.delete"
  | "agency.delete"
  | "hotel.delete"
  | "user.delete"
  | "user.role_change"
  | "user.password_change";

export interface AuditEntry {
  action: AuditAction;
  targetType: "booking" | "agency" | "hotel" | "user" | "guest";
  targetId?: number | null;
  hotelId?: number | null;
  /** Counts and field names only — never document contents or credentials. */
  detail?: Record<string, unknown>;
}

/**
 * Writes an audit record for the current request.
 *
 * Awaited so the record lands before the response, but a failure is logged
 * rather than thrown: an audit write failing should not deny a receptionist
 * access to a guest's ID at check-in, or leave a delete half-applied. The
 * trade-off is that a database problem degrades the trail, so the error is
 * logged loudly enough to be alerted on.
 *
 * `actorOverride` covers the one case where the acting account is not
 * `req.user`: a self-service password reset happens by design before the
 * caller is authenticated (the reset token stands in for a session), so
 * without it the entry would misleadingly read "(unauthenticated)" for what
 * is actually the account holder acting on their own account.
 */
export async function recordAudit(
  req: Request,
  entry: AuditEntry,
  actorOverride?: { userId: number; email: string; role: string },
): Promise<void> {
  const actor = actorOverride ?? req.user;
  try {
    await db.insert(auditLogTable).values({
      actorUserId: actor?.userId ?? null,
      actorEmail: actor?.email ?? "(unauthenticated)",
      actorRole: actor?.role ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      hotelId: entry.hotelId ?? null,
      detail: entry.detail ?? null,
    });
  } catch (error) {
    console.error(
      `[audit] FAILED to record ${entry.action} on ${entry.targetType}` +
        `${entry.targetId != null ? ` ${entry.targetId}` : ""} by ${actor?.email ?? "unknown"}`,
      error,
    );
  }
}
