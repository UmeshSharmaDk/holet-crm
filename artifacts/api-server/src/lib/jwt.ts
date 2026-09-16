import jwt from "jsonwebtoken";

// Cast to string so TypeScript knows it is never undefined
const JWT_SECRET = (process.env["JWT_SECRET"] ?? process.env["SESSION_SECRET"]) as string;

if (!JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET or SESSION_SECRET environment variable is missing.");
}

/**
 * Short by default. Role and hotel assignment are re-read from the database on
 * every request (see middlewares/auth.ts), so a long-lived token is no longer a
 * privilege-escalation window — but a shorter window still limits the damage of
 * a stolen token, which nothing else can undo.
 */
const JWT_EXPIRES_IN = process.env["JWT_EXPIRES_IN"] ?? "12h";

export interface JWTPayload {
  userId: number;
  email: string;
  role: "admin" | "owner" | "manager";
  hotelId: number | null;
  /**
   * Snapshot of the user's tokenVersion column. Changing a password bumps that
   * column, which invalidates every token issued before the change.
   */
  tokenVersion: number;
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): JWTPayload {
  // Cast to unknown first to safely bridge the overlap issue
  return jwt.verify(token, JWT_SECRET) as unknown as JWTPayload;
}
