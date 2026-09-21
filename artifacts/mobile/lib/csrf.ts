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
export function getCsrfHeader(): Record<string, string> {
  if (Platform.OS !== "web" || typeof document === "undefined") return {};

  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CSRF_COOKIE_NAME}=`));
  if (!match) return {};

  const value = decodeURIComponent(match.slice(CSRF_COOKIE_NAME.length + 1));
  return value ? { [CSRF_HEADER_NAME]: value } : {};
}
