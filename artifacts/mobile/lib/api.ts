import { getAuthToken } from "./secureStorage";
import { getCsrfHeader } from "./csrf";

const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : "";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function getToken() {
  return getAuthToken();
}

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

/**
 * On web the token is never available here (secureStorage.getAuthToken is a
 * no-op there) — the request instead relies on the httpOnly cookie the
 * browser attaches itself, which `credentials: "include"` is what makes it
 * actually send cross-origin. A mutating request also needs the CSRF header
 * that goes with a cookie session; a GET is unaffected either way, and
 * native ignores both — it has no cookie and no CSRF cookie to read.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const method = (options.method ?? "GET").toUpperCase();
  const res = await fetch(`${BASE_URL}/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(MUTATING_METHODS.has(method) ? getCsrfHeader() : {}),
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
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method: "POST",
    body,
    credentials: "include",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...getCsrfHeader() },
  });
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
