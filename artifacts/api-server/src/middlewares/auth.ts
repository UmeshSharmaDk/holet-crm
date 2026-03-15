import { Request, Response, NextFunction } from "express";
import { verifyToken, JWTPayload } from "../lib/jwt.js";

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized", message: "No token provided" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Invalid token" });
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
