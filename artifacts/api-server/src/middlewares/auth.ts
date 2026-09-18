import { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyToken, JWTPayload } from "../lib/jwt.js";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  constantTimeEquals,
  csrfTokenBelongsTo,
  readCookie,
} from "../lib/cookies.js";

/** Methods a browser will issue cross-origin without a preflight. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

/**
 * Authenticates the request and re-reads the caller's authority from the
 * database.
 *
 * The JWT is only proof of *identity*. Role and hotel assignment are read from
 * the users table on every request, so demoting a user, moving them to another
 * hotel, or deleting them takes effect immediately instead of lingering until
 * their token expires. A tokenVersion mismatch (bumped on password change)
 * rejects tokens issued before the change.
 *
 * The token arrives either in an Authorization header (native clients, which
 * hold it in the Keychain/Keystore) or in an httpOnly cookie (the web client,
 * which must not be able to read it at all). A header is never sent by the
 * browser on its own, so it needs no CSRF protection; a cookie is, so a
 * cookie-authenticated write has to prove the caller could read the CSRF
 * cookie as well.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  // An explicit header wins: a native client presenting a Bearer token must not
  // be silently authenticated as whoever a stray cookie belongs to.
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieToken = bearerToken ? null : readCookie(req, SESSION_COOKIE);
  const token = bearerToken ?? cookieToken;

  if (!token) {
    res.status(401).json({ error: "Unauthorized", message: "No token provided" });
    return;
  }

  let payload: JWTPayload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Invalid token" });
    return;
  }

  // Checked before the user lookup so a forged cross-site write costs no query.
  if (cookieToken && !SAFE_METHODS.has(req.method)) {
    const header = req.headers[CSRF_HEADER];
    const cookie = readCookie(req, CSRF_COOKIE);
    const present = typeof header === "string" && !!header && !!cookie;
    if (
      !present ||
      !constantTimeEquals(header as string, cookie as string) ||
      !csrfTokenBelongsTo(cookie as string, payload.userId)
    ) {
      res.status(403).json({ error: "Forbidden", message: "Missing or invalid CSRF token" });
      return;
    }
  }

  try {
    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        role: usersTable.role,
        hotelId: usersTable.hotelId,
        tokenVersion: usersTable.tokenVersion,
      })
      .from(usersTable)
      .where(eq(usersTable.id, payload.userId));

    // Account deleted, or credentials changed since this token was issued.
    if (!user || user.tokenVersion !== (payload.tokenVersion ?? -1)) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid token" });
      return;
    }

    req.user = {
      userId: user.id,
      email: user.email,
      role: user.role,
      hotelId: user.hotelId,
      tokenVersion: user.tokenVersion,
    };
    next();
  } catch (error) {
    console.error("[auth] failed to load user", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Forbidden", message: "Admin access required" });
    return;
  }
  next();
}

export function requireOwnerOrAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin" && req.user?.role !== "owner") {
    res.status(403).json({ error: "Forbidden", message: "Owner or Admin access required" });
    return;
  }
  next();
}
