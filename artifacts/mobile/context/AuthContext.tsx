import { router } from "expo-router";
import React, { createContext, useContext, useEffect, useState, useMemo, ReactNode } from "react";
import {
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  getCachedUser,
  setCachedUser,
  clearCachedUser,
} from "@/lib/secureStorage";

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
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : "";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  async function loadStoredAuth() {
    try {
      const storedToken = await getAuthToken();
      if (!storedToken) return;

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
      setToken(storedToken);

      // The server is the authority on who this token belongs to and what
      // role it carries. A rejected token means the session is over.
      const res = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
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
    setToken(null);
    setUser(null);
  }

  async function login(email: string, password: string) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.message ?? "Login failed");
    }
    const data = await res.json();
    await setAuthToken(data.token);
    await setCachedUser(JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  }

  async function logout() {
    await clearSession();
    router.replace("/login");
  }

  const value = useMemo(() => ({ user, token, isLoading, login, logout }), [user, token, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
