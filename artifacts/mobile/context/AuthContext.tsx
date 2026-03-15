import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { createContext, useContext, useEffect, useState, useMemo, ReactNode } from "react";

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
      const [storedToken, storedUser] = await Promise.all([
        AsyncStorage.getItem("auth_token"),
        AsyncStorage.getItem("auth_user"),
      ]);
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      }
    } catch (e) {
      console.error("Failed to load auth:", e);
    } finally {
      setIsLoading(false);
    }
  }

  async function login(email: string, password: string) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body?.message ?? "Login failed");
    }
    const data = await res.json();
    await AsyncStorage.setItem("auth_token", data.token);
    await AsyncStorage.setItem("auth_user", JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  }

  async function logout() {
    await AsyncStorage.multiRemove(["auth_token", "auth_user"]);
    setToken(null);
    setUser(null);
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
