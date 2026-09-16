import { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyToken, JWTPayload } from "../lib/jwt.js";

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
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized", message: "No token provided" });
    return;
  }

  const token = authHeader.slice(7);
  let payload: JWTPayload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Invalid token" });
    return;
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
