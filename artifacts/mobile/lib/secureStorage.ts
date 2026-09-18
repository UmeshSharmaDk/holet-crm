import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Storage for the session token.
 *
 * On native the token goes to the Keychain/Keystore rather than AsyncStorage,
 * which is an unencrypted file on disk.
 *
 * On web there is no equivalent — Expo's AsyncStorage is localStorage there —
 * so the web build does not hold a token at all. It logs in over cookie
 * transport instead: the session arrives in an httpOnly cookie that script on
 * the origin cannot read, and the only thing JavaScript sees is the CSRF token
 * it has to echo back, which is useless without the session cookie.
 */
const TOKEN_KEY = "auth_token";
const USER_CACHE_KEY = "auth_user";
const CSRF_COOKIE = "holet_csrf";

/** Web logs in with cookies; native keeps Bearer tokens in the Keychain. */
export const usesCookieAuth = Platform.OS === "web";

export async function getAuthToken(): Promise<string | null> {
  // Nothing to return: on web the token is in a cookie this code cannot read.
  if (usesCookieAuth) return null;

  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (token) return token;
    // One-time migration for sessions stored before the move to SecureStore.
    const legacy = await AsyncStorage.getItem(TOKEN_KEY);
    if (legacy) {
      await SecureStore.setItemAsync(TOKEN_KEY, legacy);
      await AsyncStorage.removeItem(TOKEN_KEY);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setAuthToken(token: string): Promise<void> {
  if (usesCookieAuth) {
    throw new Error("The web build authenticates by cookie and must not store a token");
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
}

export async function clearAuthToken(): Promise<void> {
  // Removed on web too: builds before cookie transport left a token in
  // localStorage, and it stays valid until it expires unless it is cleared.
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  if (!usesCookieAuth) {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  } else {
    expireCsrfCookie();
  }
}

/**
 * Removes a token that a build from before cookie transport left in
 * localStorage, where any script on the origin could still read it.
 *
 * Separate from clearAuthToken because that also ends the session, and a user
 * arriving with both a legacy token and a valid cookie should keep the cookie.
 */
export async function purgeLegacyWebToken(): Promise<void> {
  if (!usesCookieAuth) return;
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
}

/**
 * The CSRF token the server issued at login, read from its (deliberately
 * readable) cookie. Every unsafe request echoes it in a header: another origin
 * can make the browser send the session cookie, but cannot read this one.
 */
export function getCsrfToken(): string | null {
  if (!usesCookieAuth || typeof document === "undefined") return null;

  for (const part of document.cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== CSRF_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Drops the local half of the session immediately.
 *
 * The server expires both cookies on logout; this covers the case where that
 * request never lands, so the app does not start up believing it has a session.
 */
function expireCsrfCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${CSRF_COOKIE}=; Path=/; Max-Age=0`;
}

/**
 * Cached profile, used only to render something before /auth/me answers.
 * It is never the source of truth for role or hotel — the server is.
 */
export async function getCachedUser(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(USER_CACHE_KEY);
  } catch {
    return null;
  }
}

export async function setCachedUser(json: string): Promise<void> {
  await AsyncStorage.setItem(USER_CACHE_KEY, json).catch(() => {});
}

export async function clearCachedUser(): Promise<void> {
  await AsyncStorage.removeItem(USER_CACHE_KEY).catch(() => {});
}
