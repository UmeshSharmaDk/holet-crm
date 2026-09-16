import { Request, Response, NextFunction } from "express";
import { SQL, eq } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Which hotels the current request is allowed to touch.
 *
 * Deliberately a discriminated union rather than `number | undefined`: an
 * absent hotel used to be indistinguishable from "no filter", so a non-admin
 * whose hotelId was null silently received every hotel's data. Forcing callers
 * to branch on `kind` makes the platform-wide case something you have to opt
 * into, and only an admin can ever reach it.
 */
export type HotelScope =
  | { kind: "all" }
  | { kind: "hotel"; hotelId: number };

declare global {
  namespace Express {
    interface Request {
      hotelScope?: HotelScope;
    }
  }
}

/**
 * Resolves the caller's hotel scope, failing closed.
 *
 * - admin: the requested hotel when one is given, otherwise every hotel.
 * - everyone else: strictly their own hotel. A non-admin with no hotel
 *   assignment gets no scope at all (403) rather than an unfiltered query.
 */
export function requireHotelScope(req: Request, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized", message: "No token provided" });
    return;
  }

  if (user.role === "admin") {
    const raw = req.query["hotelId"];
    if (raw === undefined || raw === "" || raw === "all") {
      req.hotelScope = { kind: "all" };
      next();
      return;
    }
    const hotelId = Number.parseInt(String(raw), 10);
    if (!Number.isInteger(hotelId) || hotelId <= 0) {
      res.status(400).json({ error: "Bad Request", message: "hotelId must be a positive integer" });
      return;
    }
    req.hotelScope = { kind: "hotel", hotelId };
    next();
    return;
  }

  if (user.hotelId == null) {
    res.status(403).json({
      error: "Forbidden",
      message: "Your account is not assigned to a hotel. Ask an administrator to assign one.",
    });
    return;
  }

  req.hotelScope = { kind: "hotel", hotelId: user.hotelId };
  next();
}

/** True when `scope` covers the given hotel. */
export function scopeAllows(scope: HotelScope, hotelId: number | null): boolean {
  if (scope.kind === "all") return true;
  return hotelId === scope.hotelId;
}

/**
 * Builds the hotel predicate for a query, or `undefined` for a platform-wide
 * (admin) scope. Never returns a match-everything predicate for a tenant.
 */
export function hotelFilter(scope: HotelScope, column: PgColumn): SQL | undefined {
  return scope.kind === "hotel" ? eq(column, scope.hotelId) : undefined;
}

/**
 * Replies 404 when the caller may not touch this record.
 *
 * 404 rather than 403 on purpose: a 403 would confirm that the id exists,
 * which is exactly the signal an attacker enumerating ids is looking for.
 */
export function denyOutOfScope(
  res: Response,
  scope: HotelScope,
  hotelId: number | null,
): boolean {
  if (scopeAllows(scope, hotelId)) return false;
  res.status(404).json({ error: "Not Found" });
  return true;
}
