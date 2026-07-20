/**
 * shared/auth — the auth store + React context (docs/08 auth slice, priority #2).
 *
 * Holds `{ user, status }`, persists the tokens to localStorage (via
 * {@link tokenStore}), and exposes `login`, `logout`, `loadMe`, plus the OTP
 * registration helpers. On app boot, if a token exists it hydrates `user` from
 * `/api/auth/me` and clears the tokens if that 401s (expired session).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { endpoints, isApiError } from "../api";
import type { MeResponse, RegisterPayload } from "../api";
import { tokenStore } from "./tokens";

/** boot = hydrating from a stored token; ready = resolved (in or out). */
export type AuthStatus = "boot" | "ready";

export interface AuthContextValue {
  user: MeResponse | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  /** Email + password → stores tokens, hydrates `user`. Throws ApiError on 401/403. */
  login: (email: string, password: string) => Promise<MeResponse>;
  /** Clears tokens + user (best-effort server logout). */
  logout: () => void;
  /** Re-fetch `/me` into `user`. */
  loadMe: () => Promise<MeResponse>;
  /** OTP step 1 — send a code to the email. */
  requestEmailCode: (email: string) => Promise<{ ok: boolean; expires_in: number }>;
  /** OTP step 2 — exchange a code for the email-verify token. */
  verifyEmailCode: (email: string, code: string) => Promise<string>;
  /** Create the account (student), then log straight in. */
  register: (payload: RegisterPayload) => Promise<MeResponse>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<AuthStatus>(tokenStore.access ? "boot" : "ready");
  const booted = useRef(false);

  const loadMe = useCallback(async () => {
    // Boot hydration passes skipRedirect so a stale token clears without a bounce.
    const me = await endpoints.me(true);
    setUser(me);
    return me;
  }, []);

  // Boot: hydrate the user from a stored token (once).
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    if (!tokenStore.access) {
      setStatus("ready");
      return;
    }
    loadMe()
      .catch(() => {
        tokenStore.clear();
        setUser(null);
      })
      .finally(() => setStatus("ready"));
  }, [loadMe]);

  const login = useCallback(async (email: string, password: string) => {
    const tokens = await endpoints.login(email, password);
    tokenStore.set(tokens.access_token, tokens.refresh_token);
    const me = await endpoints.me(true);
    setUser(me);
    setStatus("ready");
    return me;
  }, []);

  const logout = useCallback(() => {
    // Fire-and-forget: the .NET logout is a no-op (stateless JWT); ignore errors.
    endpoints.logout().catch(() => undefined);
    tokenStore.clear();
    setUser(null);
    setStatus("ready");
  }, []);

  const requestEmailCode = useCallback(
    (email: string) => endpoints.requestEmailCode(email),
    [],
  );

  const verifyEmailCode = useCallback(async (email: string, code: string) => {
    const res = await endpoints.verifyEmailCode(email, code);
    return res.email_verify_token;
  }, []);

  const register = useCallback(
    async (payload: RegisterPayload) => {
      const created = await endpoints.register(payload);
      // Registration always creates an active student → log straight in.
      try {
        await login(payload.email, payload.password);
      } catch (e) {
        // Account created but auto-login failed (e.g. awaiting approval) —
        // return the created user; the caller routes to /login.
        if (isApiError(e) && e.status === 403) return created;
        throw e;
      }
      return created;
    },
    [login],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isAuthenticated: user !== null,
      login,
      logout,
      loadMe,
      requestEmailCode,
      verifyEmailCode,
      register,
    }),
    [user, status, login, logout, loadMe, requestEmailCode, verifyEmailCode, register],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
