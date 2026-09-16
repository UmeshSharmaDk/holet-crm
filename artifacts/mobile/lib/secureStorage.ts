import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Storage for the session token.
 *
 * On native the token goes to the Keychain/Keystore rather than AsyncStorage,
 * which is an unencrypted file on disk. On web there is no equivalent — Expo's
 * AsyncStorage is localStorage there — so the token stays in localStorage and
 * the defence is that nothing injects script into the origin (see the host
 * escaping in server/serve.js).
 */
const TOKEN_KEY = "auth_token";
const USER_CACHE_KEY = "auth_user";

const useSecureStore = Platform.OS !== "web";

export async function getAuthToken(): Promise<string | null> {
  if (!useSecureStore) {
    try {
      return await AsyncStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }
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
  if (!useSecureStore) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
}

export async function clearAuthToken(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  if (useSecureStore) {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  }
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
