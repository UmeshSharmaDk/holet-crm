import { getAuthToken } from "./secureStorage";
import { getCsrfHeader } from "./csrf";
import { refreshAfterWrite } from "./query-client";
import { Platform } from "react-native";

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
    credentials: Platform.OS === "web" ? "include" : "omit",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(MUTATING_METHODS.has(method) ? await getCsrfHeader() : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body?.message ?? `Request failed: ${res.status}`, res.status, body);
  }
  const data = res.status === 204 ? undefined : await res.json();
  if (MUTATING_METHODS.has(method)) await refreshAfterWrite(path);
  return data as T;
}

async function upload<T>(path: string, body: FormData): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method: "POST",
    body,
    credentials: Platform.OS === "web" ? "include" : "omit",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...await getCsrfHeader() },
  });
  if (!res.ok) {
    const responseBody = await res.json().catch(() => ({}));
    throw new Error(responseBody?.message ?? `Request failed: ${res.status}`);
  }
  const data = await res.json();
  await refreshAfterWrite(path);
  return data as T;
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
