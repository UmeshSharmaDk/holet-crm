import jwt from "jsonwebtoken";

const JWT_SECRET = process.env["JWT_SECRET"] ?? "hotel-crm-secret-key-change-in-production";

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
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
}
