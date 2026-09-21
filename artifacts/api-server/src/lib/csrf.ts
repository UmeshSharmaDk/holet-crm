import crypto from "node:crypto";

export const CSRF_COOKIE_NAME = "csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Double-submit check for a cookie-authenticated request.
 *
 * Only meaningful when the browser is attaching the session ambiently (the
 * httpOnly auth cookie): a cross-site page can make the browser send that
 * cookie, but it cannot read the separate csrf_token cookie to also send a
 * matching header, since it runs on a different origin. A request that
 * proved itself with a Bearer header instead never needs this — nothing
 * ambient carries a custom Authorization header cross-site.
 */
export function csrfTokenMatches(req: { cookies?: Record<string, string>; headers: Record<string, unknown> }): boolean {
  const cookieValue = req.cookies?.[CSRF_COOKIE_NAME];
  const headerValue = req.headers[CSRF_HEADER_NAME];
  return typeof cookieValue === "string" && cookieValue.length > 0 && cookieValue === headerValue;
}
