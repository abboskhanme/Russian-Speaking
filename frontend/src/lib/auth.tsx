import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, tokenStore } from "./api";
import type { User } from "./types";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    full_name: string,
    role: "teacher" | "student",
  ) => Promise<{ pending: boolean }>;
  loginWithGoogle: (credential: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenStore.access) {
      setLoading(false);
      return;
    }
    api
      .get<User>("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    // OAuth2 password flow expects form-encoded username/password.
    const form = new URLSearchParams({ username: email, password });
    const { data } = await api.post("/auth/login", form);
    tokenStore.set(data.access_token, data.refresh_token);
    const me = await api.get<User>("/auth/me");
    setUser(me.data);
  }

  async function register(
    email: string,
    password: string,
    full_name: string,
    role: "teacher" | "student",
  ) {
    const { data } = await api.post<User>("/auth/register", { email, password, full_name, role });
    // Teachers are created inactive (pending admin approval) — don't log in.
    if (!data.is_active) return { pending: true };
    await login(email, password);
    return { pending: false };
  }

  async function loginWithGoogle(credential: string) {
    const { data } = await api.post("/auth/google", { credential });
    tokenStore.set(data.access_token, data.refresh_token);
    const me = await api.get<User>("/auth/me");
    setUser(me.data);
  }

  async function refreshUser() {
    const me = await api.get<User>("/auth/me");
    setUser(me.data);
  }

  function logout() {
    tokenStore.clear();
    setUser(null);
  }

  return (
    <Ctx.Provider value={{ user, loading, login, register, loginWithGoogle, refreshUser, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
