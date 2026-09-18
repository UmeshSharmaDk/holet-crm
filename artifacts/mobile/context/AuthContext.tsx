import { router } from "expo-router";
import React, { createContext, useContext, useEffect, useState, useMemo, ReactNode } from "react";
import {
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  getCachedUser,
  setCachedUser,
  clearCachedUser,
  getCsrfToken,
  purgeLegacyWebToken,
  usesCookieAuth,
} from "@/lib/secureStorage";
import { BASE_URL, authFetch } from "@/lib/api";

export type UserRole = "admin" | "owner" | "manager";

export interface Hotel {
  id: number;
  name: string;
  totalRooms: number;
  createdAt: string;
}

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  hotelId: number | null;
  hotel: Hotel | null;
  createdAt: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

/**
 * The session token is deliberately not on this value. On web it does not
 * exist in JavaScript at all, and on native it belongs in the Keychain rather
 * than in React state — nothing in the app ever needed to read it directly.
 */
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  async function loadStoredAuth() {
    try {
      if (usesCookieAuth) {
        // Builds before cookie transport left a live token in localStorage.
        // Clear it so it stops being reachable by script on this origin.
        await purgeLegacyWebToken();
        // The session cookie is httpOnly and unreadable, but its CSRF sibling
        // is not, so its presence is the local signal that a session exists.
        if (!getCsrfToken()) return;
      } else {
        const storedToken = await getAuthToken();
        if (!storedToken) return;
      }

      // Render immediately from the cached profile, but never trust it: the
      // cache is editable on web, and role drives which screens are shown.
      const cached = await getCachedUser();
      if (cached) {
        try {
          setUser(JSON.parse(cached));
        } catch {
          await clearCachedUser();
        }
      }

      // The server is the authority on who this session belongs to and what
      // role it carries. A rejected session means it is over.
      const res = await authFetch(`${BASE_URL}/api/auth/me`);
      if (res.status === 401) {
        await clearSession();
        return;
      }
      if (res.ok) {
        const fresh: AuthUser = await res.json();
        setUser(fresh);
        await setCachedUser(JSON.stringify(fresh));
      }
    } catch (e) {
      // Offline: keep the cached profile so the app still opens. Every request
      // is still authorised server-side, so a stale cache grants nothing.
      console.error("Failed to load auth:", e);
    } finally {
      setIsLoading(false);
    }
  }

  async function clearSession() {
    await clearAuthToken();
    await clearCachedUser();
    setUser(null);
  }

  async function login(email: string, password: string) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Asks the server to keep the token out of the response entirely and
        // return it as an httpOnly cookie instead.
        ...(usesCookieAuth ? { "X-Auth-Transport": "cookie" } : {}),
      },
      ...(usesCookieAuth ? { credentials: "include" as const } : {}),
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.message ?? "Login failed");
    }
    const data = await res.json();

    if (usesCookieAuth) {
      // The response carries no token, so the only evidence the session was
      // established is the cookie pair. If the browser declined it there is
      // nothing to fall back to, and saying so beats appearing to sign in and
      // then failing every subsequent request.
      if (!getCsrfToken()) {
        console.error(
          "Login succeeded but no session cookie was stored. If the API is on a " +
            "different site from this app, the server needs AUTH_COOKIE_SAMESITE=none.",
        );
        throw new Error("Your browser did not accept the session cookie, so sign-in could not be completed.");
      }
    } else {
      await setAuthToken(data.token);
    }

    await setCachedUser(JSON.stringify(data.user));
    setUser(data.user);
  }

  async function logout() {
    // Only the server can expire an httpOnly cookie, so on web logging out is
    // a request. A failure still clears everything locally.
    if (usesCookieAuth) {
      await authFetch(`${BASE_URL}/api/auth/logout`, { method: "POST" }).catch((e) =>
        console.error("Logout request failed:", e),
      );
    }
    await clearSession();
    router.replace("/login");
  }

  const value = useMemo(() => ({ user, isLoading, login, logout }), [user, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
