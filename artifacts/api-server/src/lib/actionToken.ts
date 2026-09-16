import crypto from "crypto";

const JWT_SECRET = process.env["JWT_SECRET"] as string;

if (!JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is missing.");
}

// Separate key material so an action token can never be mistaken for a session token.
const ACTION_KEY = crypto.createHmac("sha256", JWT_SECRET).update("ai-action-v1").digest();

const TTL_MS = 10 * 60 * 1000;

export interface PendingAction {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Signs a proposed write so the client can confirm exactly that write and
 * nothing else. The token is bound to the requesting user and expires, so a
 * confirmation cannot be replayed, retargeted at another record, or forged by
 * a client that edits the action it was shown.
 */
export function signAction(userId: number, action: PendingAction): string {
  const payload = Buffer.from(
    JSON.stringify({ userId, action, exp: Date.now() + TTL_MS }),
  ).toString("base64url");
  const mac = crypto.createHmac("sha256", ACTION_KEY).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyAction(token: unknown, userId: number): PendingAction | null {
  if (typeof token !== "string") return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;

  const expected = crypto.createHmac("sha256", ACTION_KEY).update(payload).digest("base64url");
  const given = Buffer.from(mac);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (decoded.userId !== userId) return null;
    if (typeof decoded.exp !== "number" || decoded.exp < Date.now()) return null;
    if (!decoded.action?.name) return null;
    return decoded.action as PendingAction;
  } catch {
    return null;
  }
}
