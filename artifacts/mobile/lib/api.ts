import { getAuthToken, getCsrfToken, usesCookieAuth } from "./secureStorage";

export const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

/** An error that keeps the server's status and body, so callers can branch on them. */
export class ApiError extends Error {
  readonly status: number;
  readonly data: any;

  constructor(message: string, status: number, data: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

/** Methods the browser would issue cross-origin without a preflight. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * fetch with whatever credential this platform uses.
 *
 * Native sends the Bearer token it holds in the Keychain. Web sends nothing
 * itself — the session is an httpOnly cookie the browser attaches, which is
 * why unsafe methods have to carry the CSRF token back in a header that no
 * other origin could set.
 *
 * Every authenticated request in the app goes through here, so there is one
 * place where that decision lives rather than one per call site.
 */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();

  if (usesCookieAuth) {
    const csrf = getCsrfToken();
    if (csrf && !SAFE_METHODS.has(method)) headers.set("X-CSRF-Token", csrf);
    return fetch(url, { ...init, headers, credentials: "include" });
  }

  const token = await getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await authFetch(`${BASE_URL}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body?.message ?? `Request failed: ${res.status}`, res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function upload<T>(path: string, body: FormData): Promise<T> {
  // No Content-Type: fetch has to set the multipart boundary itself.
  const res = await authFetch(`${BASE_URL}/api${path}`, { method: "POST", body });
  if (!res.ok) {
    const responseBody = await res.json().catch(() => ({}));
    throw new Error(responseBody?.message ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "DELETE",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  upload,
};
