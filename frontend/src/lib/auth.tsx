import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, tokenStore } from "./api";
import type { User } from "./types";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  requestEmailCode: (email: string) => Promise<void>;
  verifyEmailCode: (email: string, code: string) => Promise<string>;
  register: (data: {
    email: string;
    password: string;
    full_name: string;
    phone: string;
    age: number;
    region: string;
    district: string;
    email_verify_token?: string;
    group_code?: string;
  }) => Promise<{ pending: boolean }>;
  loginWithGoogle: (credential: string, group_code?: string) => Promise<void>;
  completeProfile: (data: Partial<{
    phone: string;
    age: number;
    region: string;
    district: string;
  }>) => Promise<void>;
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

  // Step 1 of email verification: send a one-time code to the address.
  async function requestEmailCode(email: string) {
    await api.post("/auth/email/request-code", { email });
  }

  // Step 2: exchange a correct code for a short-lived proof token.
  async function verifyEmailCode(email: string, code: string): Promise<string> {
    const { data } = await api.post("/auth/email/verify-code", { email, code });
    return data.email_verify_token as string;
  }

  async function register(data: {
    email: string;
    password: string;
    full_name: string;
    phone: string;
    age: number;
    region: string;
    district: string;
    email_verify_token?: string;
    group_code?: string;
  }) {
    const { data: created } = await api.post<User>("/auth/register", data);
    // Sign-up always creates an active student — log straight in.
    if (!created.is_active) return { pending: true };
    await login(data.email, data.password);
    return { pending: false };
  }

  async function loginWithGoogle(credential: string, group_code?: string) {
    const { data } = await api.post("/auth/google", { credential, group_code });
    tokenStore.set(data.access_token, data.refresh_token);
    const me = await api.get<User>("/auth/me");
    setUser(me.data);
  }

  // Used by the complete-profile gate (Google sign-ups have no phone/address yet).
  async function completeProfile(data: Partial<{
    phone: string;
    age: number;
    region: string;
    district: string;
  }>) {
    const { data: updated } = await api.patch<User>("/auth/me", data);
    setUser(updated);
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
    <Ctx.Provider value={{ user, loading, login, requestEmailCode, verifyEmailCode, register, loginWithGoogle, completeProfile, refreshUser, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
