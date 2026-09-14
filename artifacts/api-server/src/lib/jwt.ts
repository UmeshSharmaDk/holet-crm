import jwt from "jsonwebtoken";

// Cast to string so TypeScript knows it is never undefined
const JWT_SECRET = process.env["JWT_SECRET"] as string;

if (!JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is missing.");
}

export interface JWTPayload {
  userId: number;
  email: string;
  role: "admin" | "owner" | "manager";
  hotelId: number | null;
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JWTPayload {
  // Cast to unknown first to safely bridge the overlap issue
  return jwt.verify(token, JWT_SECRET) as unknown as JWTPayload;
}
