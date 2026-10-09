import type { CookieOptions, Response } from "express";
import { generateCsrfToken, CSRF_COOKIE_NAME } from "./csrf.js";

export const AUTH_COOKIE_NAME = "auth_token";

const isProduction = process.env.NODE_ENV === "production";

/**
 * SameSite=None is required because the two are genuinely cross-site in
 * production (the mobile web build is served from its own static host,
 * separate from this API), and None requires Secure.
 *
 * In development, localhost:3000 and localhost:8081 are different origins
 * (different ports) but the same *site* — SameSite is computed on the
 * registrable domain and ignores the port — so Lax already crosses that
 * boundary without needing HTTPS, which plain http://localhost doesn't have.
 */
const sameSite: CookieOptions["sameSite"] = isProduction ? "none" : "lax";
const secure = isProduction;

const AUTH_COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // matches JWT_EXPIRES_IN's default

/**
 * Sets the web session: an httpOnly cookie carrying the token, invisible to
 * JS, plus a separate, readable CSRF cookie the client echoes back as a
 * header on mutating requests. Native ignores both — it authenticates with
 * the token from the JSON response body instead.
 */
export function setAuthCookies(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
  });
  res.cookie(CSRF_COOKIE_NAME, generateCsrfToken(), {
    httpOnly: false,
    secure,
    sameSite,
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
  });
}

/** Clears both cookies set at login. A no-op for a native client that never had them. */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, { path: "/" });
  res.clearCookie(CSRF_COOKIE_NAME, { path: "/" });
}
