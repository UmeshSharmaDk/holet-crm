import crypto from "crypto";
import { db, consumedActionTokensTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { isUniqueViolation } from "./dbErrors.js";

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

interface DecodedAction {
  action: PendingAction;
  jti: string;
  exp: number;
}

/**
 * Signs a proposed write so the client can confirm exactly that write and
 * nothing else. The token is bound to the requesting user and expires, so a
 * confirmation cannot be retargeted at another record or forged by a client
 * that edits the action it was shown. `jti` is what makes it single-use —
 * see consumeAction.
 */
export function signAction(userId: number, action: PendingAction): string {
  const jti = crypto.randomBytes(16).toString("hex");
  const payload = Buffer.from(
    JSON.stringify({ userId, action, jti, exp: Date.now() + TTL_MS }),
  ).toString("base64url");
  const mac = crypto.createHmac("sha256", ACTION_KEY).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function decode(token: unknown, userId: number): DecodedAction | null {
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
    if (typeof decoded.jti !== "string" || !decoded.jti) return null;
    return { action: decoded.action as PendingAction, jti: decoded.jti, exp: decoded.exp };
  } catch {
    return null;
  }
}

/**
 * Checks a token's signature, expiry and owner without consuming it. Use
 * consumeAction, not this, at the point a confirmation is actually acted on
 * — this exists for lightweight checks that never execute anything.
 */
export function verifyAction(token: unknown, userId: number): PendingAction | null {
  return decode(token, userId)?.action ?? null;
}

export type ConsumeActionResult =
  | { status: "confirmed"; action: PendingAction }
  | { status: "already_used" }
  | { status: "invalid" };

let lastSweep = 0;

/** Expired rows are harmless to leave — a token that old fails decode's exp check anyway — so this is opportunistic rather than scheduled. */
async function sweepExpired(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  try {
    await db.delete(consumedActionTokensTable).where(lt(consumedActionTokensTable.expiresAt, new Date()));
  } catch (error) {
    console.error("[action-token] sweep failed", error);
  }
}

/**
 * Verifies a token and marks it spent, atomically: the insert's primary-key
 * constraint on `jti` is what makes two concurrent confirmations of the same
 * token resolve to exactly one "confirmed" and one "already_used", with no
 * separate read-then-write race to get wrong.
 */
export async function consumeAction(token: unknown, userId: number): Promise<ConsumeActionResult> {
  const decoded = decode(token, userId);
  if (!decoded) return { status: "invalid" };

  try {
    await db.insert(consumedActionTokensTable).values({
      jti: decoded.jti,
      expiresAt: new Date(decoded.exp),
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "already_used" };
    throw error;
  }

  void sweepExpired();
  return { status: "confirmed", action: decoded.action };
}
