import { Response } from "express";

/**
 * Request-shape helpers.
 *
 * The generated schemas in @workspace/api-zod are built from an OpenAPI spec
 * that has drifted from the database (it still carries roomNumber/roomType and
 * lacks numberOfRooms/numberOfPersons), so validating against them would reject
 * valid requests. These helpers validate against the schema the routes actually
 * write to.
 */

/**
 * A whole positive number and nothing else.
 *
 * `Number.parseInt` stops at the first character it cannot read, so "1.5.2",
 * "1abc" and " 1" all become 1 — an id the caller never asked for, silently
 * substituted. Matching the whole string first means malformed input is
 * rejected instead of quietly resolving to a different record.
 */
const POSITIVE_INTEGER = /^[0-9]+$/;

function toPositiveInteger(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  }
  const text = String(raw ?? "").trim();
  if (!POSITIVE_INTEGER.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Parses a positive integer route param; replies 400 and returns null if invalid. */
export function parseIdParam(res: Response, raw: unknown, field = "id"): number | null {
  const value = toPositiveInteger(raw);
  if (value === null) {
    res.status(400).json({ error: "Bad Request", message: `${field} must be a positive integer` });
    return null;
  }
  return value;
}

/** Same as parseIdParam but for optional values; `undefined` stays undefined. */
export function parseOptionalId(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "" || raw === "null") return null;
  return toPositiveInteger(raw) ?? undefined;
}

export class ValidationError extends Error {}

/**
 * Coerces a money amount. Rejects NaN, Infinity and negatives — `parseFloat` of
 * a missing or garbage field used to yield NaN, which Postgres stores in a
 * numeric column and which then poisons every downstream revenue total.
 */
export function money(raw: unknown, field: string, fallback?: number): number {
  if (raw === undefined || raw === null || raw === "") {
    if (fallback !== undefined) return fallback;
    throw new ValidationError(`${field} is required`);
  }
  const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(value)) {
    throw new ValidationError(`${field} must be a number`);
  }
  if (value < 0) {
    throw new ValidationError(`${field} must not be negative`);
  }
  if (value > 99_999_999.99) {
    throw new ValidationError(`${field} is out of range`);
  }
  return Math.round(value * 100) / 100;
}

/** Coerces a positive integer count (rooms, persons). */
export function count(raw: unknown, field: string, fallback: number): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new ValidationError(`${field} must be a whole number between 1 and 10000`);
  }
  return value;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates a YYYY-MM-DD calendar date. */
export function isoDate(raw: unknown, field: string): string {
  const value = String(raw ?? "");
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${field} must be a date in YYYY-MM-DD format`);
  }
  return value;
}

/** Trims and length-checks a required string. */
export function text(raw: unknown, field: string, max = 500): string {
  const value = String(raw ?? "").trim();
  if (!value) throw new ValidationError(`${field} is required`);
  if (value.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return value;
}

/** Trims and length-checks an optional string; empty becomes null. */
export function optionalText(raw: unknown, field: string, max = 500): string | null {
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  if (value.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return value;
}

export function oneOf<T extends string>(raw: unknown, field: string, allowed: readonly T[], fallback?: T): T {
  if (raw === undefined || raw === null || raw === "") {
    if (fallback !== undefined) return fallback;
    throw new ValidationError(`${field} is required`);
  }
  const value = String(raw) as T;
  if (!allowed.includes(value)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

export const BOOKING_STATUSES = ["confirmed", "checked_in", "checked_out", "cancelled"] as const;
export const USER_ROLES = ["admin", "owner", "manager"] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function email(raw: unknown, field = "email"): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(value) || value.length > 320) {
    throw new ValidationError(`${field} must be a valid email address`);
  }
  return value;
}

export function optionalEmail(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  return email(raw, field);
}

export const MIN_PASSWORD_LENGTH = 10;

/** Shared by admin-driven and self-service password changes. */
export function password(raw: unknown, field = "password"): string {
  const value = String(raw ?? "");
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`${field} must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (value.length > 200) {
    throw new ValidationError(`${field} must be at most 200 characters`);
  }
  return value;
}

/** Replies 400 for a ValidationError, otherwise re-throws. */
export function handleValidationError(res: Response, error: unknown): boolean {
  if (error instanceof ValidationError) {
    res.status(400).json({ error: "Bad Request", message: error.message });
    return true;
  }
  return false;
}
