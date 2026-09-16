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
 */
export async function recordAudit(req: Request, entry: AuditEntry): Promise<void> {
  const user = req.user;
  try {
    await db.insert(auditLogTable).values({
      actorUserId: user?.userId ?? null,
      actorEmail: user?.email ?? "(unauthenticated)",
      actorRole: user?.role ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      hotelId: entry.hotelId ?? null,
      detail: entry.detail ?? null,
    });
  } catch (error) {
    console.error(
      `[audit] FAILED to record ${entry.action} on ${entry.targetType}` +
        `${entry.targetId != null ? ` ${entry.targetId}` : ""} by ${user?.email ?? "unknown"}`,
      error,
    );
  }
}
