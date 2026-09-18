import crypto from "crypto";
import type { CookieOptions, Request, Response } from "express";

const JWT_SECRET = (process.env["JWT_SECRET"] ?? process.env["SESSION_SECRET"]) as string;

if (!JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET or SESSION_SECRET environment variable is missing.");
}

/** Holds the session JWT. httpOnly, so script on the origin cannot read it. */
export const SESSION_COOKIE = "holet_session";

/**
 * Holds the CSRF token. Deliberately readable by script: the client has to echo
 * it back in a header, and a cross-origin page cannot read it or set the header.
 */
export const CSRF_COOKIE = "holet_csrf";

export const CSRF_HEADER = "x-csrf-token";

/** Opt-in marker sent by the web client so native clients keep Bearer tokens. */
export const TRANSPORT_HEADER = "x-auth-transport";

/**
 * Cross-site deployments (app and API on different registrable domains) need
 * SameSite=None, which browsers only honour on a Secure cookie. Same-site
 * deployments get Lax, which blocks the cross-origin request outright and
 * leaves the CSRF token as defence in depth rather than the only defence.
 */
const SAME_SITE_VALUES = ["lax", "strict", "none"] as const;
type SameSite = (typeof SAME_SITE_VALUES)[number];

const configured = String(process.env["AUTH_COOKIE_SAMESITE"] ?? "lax").toLowerCase();
const sameSite: SameSite = (SAME_SITE_VALUES as readonly string[]).includes(configured)
  ? (configured as SameSite)
  : "lax";

// SameSite=None is rejected by browsers without Secure, so it forces it on. In
// development the app is served over plain http://localhost, where a Secure
// cookie would simply never be stored.
const secure = process.env["NODE_ENV"] === "production" || sameSite === "none";

function baseOptions(maxAgeMs: number): CookieOptions {
  return { sameSite, secure, path: "/", maxAge: maxAgeMs };
}

/**
 * Reads one cookie from the request.
 *
 * Express parses cookies only with cookie-parser installed, and this is the
 * whole of what is needed from it — not worth a dependency.
 */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // A malformed percent-escape is not a cookie we can use.
      return null;
    }
  }
  return null;
}

// Separate key material, so a CSRF token can never be mistaken for a session or
// action token even though all three derive from the same secret.
const CSRF_KEY = crypto.createHmac("sha256", JWT_SECRET).update("csrf-v1").digest();

function csrfMac(nonce: string, userId: number): string {
  return crypto.createHmac("sha256", CSRF_KEY).update(`${nonce}|${userId}`).digest("base64url");
}

/**
 * Mints a CSRF token bound to one user.
 *
 * Plain double-submit only proves the header and the cookie agree, which anyone
 * who can set a cookie on the domain can arrange — a sibling subdomain, or a
 * network attacker on a plaintext hop. Signing the token over the user id means
 * a value the attacker planted does not verify against the session it is
 * presented with.
 */
export function mintCsrfToken(userId: number): string {
  const nonce = crypto.randomBytes(18).toString("base64url");
  return `${nonce}.${csrfMac(nonce, userId)}`;
}

export function csrfTokenBelongsTo(token: string, userId: number): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  return constantTimeEquals(token.slice(dot + 1), csrfMac(token.slice(0, dot), userId));
}

export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Puts the session in cookies instead of the response body.
 *
 * The session cookie expires with the token it carries, so a browser does not
 * keep presenting a credential the server will reject anyway.
 */
export function issueSessionCookies(
  res: Response,
  token: string,
  userId: number,
  expiresAt: Date | null,
): void {
  const maxAgeMs = Math.max(0, (expiresAt?.getTime() ?? Date.now() + 12 * 60 * 60 * 1000) - Date.now());
  res.cookie(SESSION_COOKIE, token, { ...baseOptions(maxAgeMs), httpOnly: true });
  res.cookie(CSRF_COOKIE, mintCsrfToken(userId), { ...baseOptions(maxAgeMs), httpOnly: false });
}

export function clearSessionCookies(res: Response): void {
  // clearCookie only matches on path/sameSite/secure/domain, so the attributes
  // have to be the ones the cookie was set with or the browser keeps it.
  const { maxAge: _maxAge, ...attrs } = baseOptions(0);
  res.clearCookie(SESSION_COOKIE, { ...attrs, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...attrs, httpOnly: false });
}

/** True when the caller asked to be authenticated by cookie rather than Bearer. */
export function wantsCookieSession(req: Request): boolean {
  return String(req.headers[TRANSPORT_HEADER] ?? "").toLowerCase() === "cookie";
}

/**
 * The double-submit half of the CSRF check: the header the client set has to
 * match the cookie the browser sent. A cross-origin page can cause the cookie
 * to be sent but cannot read it, and cannot set the header without a preflight
 * the origin allowlist refuses.
 */
export function csrfHeaderMatchesCookie(req: Request): boolean {
  const header = req.headers[CSRF_HEADER];
  const cookie = readCookie(req, CSRF_COOKIE);
  if (typeof header !== "string" || !header || !cookie) return false;
  return constantTimeEquals(header, cookie);
}
