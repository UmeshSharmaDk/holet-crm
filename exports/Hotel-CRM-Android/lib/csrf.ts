import { Platform } from "react-native";

const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "X-CSRF-Token";

/**
 * Reads the CSRF cookie the server set at login, to echo back as a header
 * on mutating requests (the double-submit pattern the auth cookie needs).
 *
 * Native never has this: it authenticates with a Bearer header instead of a
 * cookie, which nothing ambient can attach cross-site, so there is nothing
 * to defend here. `document` does not exist there at all.
 */
export async function getCsrfHeader(): Promise<Record<string, string>> {
  if (Platform.OS !== "web" || typeof document === "undefined") return {};

  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CSRF_COOKIE_NAME}=`));
  if (match) {
    const value = decodeURIComponent(match.slice(CSRF_COOKIE_NAME.length + 1));
    if (value) return { [CSRF_HEADER_NAME]: value };
  }
  // Cross-origin web clients cannot read the API host's document.cookie.
  // Fetch only the CSRF value through the API's existing CORS allowlist.
  const baseUrl = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : "";
  const response = await fetch(`${baseUrl}/api/auth/csrf`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to prepare a secure request. Please try again.");
  const { csrfToken } = await response.json();
  return typeof csrfToken === "string" && csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {};
}
