import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Storage for the session token.
 *
 * On native the token goes to the Keychain/Keystore rather than AsyncStorage,
 * which is an unencrypted file on disk.
 *
 * On web there is no such secure store — Expo's AsyncStorage is localStorage
 * there, plainly readable by any script on the origin. The token used to be
 * kept there anyway, defended only by there being no XSS to read it. It no
 * longer is: the web client authenticates with an httpOnly cookie the server
 * sets on login, which JS cannot read even if it is compromised. getAuthToken
 * and setAuthToken are therefore no-ops on web; a token that already exists
 * from before this change is actively purged, since a script that can read
 * localStorage does not stop being a threat just because nothing new is
 * written there.
 */
const TOKEN_KEY = "auth_token";
const USER_CACHE_KEY = "auth_user";

const isWeb = Platform.OS === "web";
const useSecureStore = !isWeb;

export async function getAuthToken(): Promise<string | null> {
  if (isWeb) {
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
    return null;
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
  if (isWeb) return;
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
