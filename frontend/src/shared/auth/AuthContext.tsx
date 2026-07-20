/**
 * shared/auth — the auth store + React context (docs/08 auth slice, priority #2).
 *
 * Holds `{ user, status }`, persists the tokens to localStorage (via
 * {@link tokenStore}), and exposes the phone + Telegram-bot OTP flow
 * (`requestOtp`, `verifyOtp`) plus `logout` / `loadMe`. On app boot, if a token
 * exists it hydrates `user` from `/api/auth/me` and clears the tokens if that
 * 401s (expired session).
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
import { endpoints, isNeedsRegistration } from "../api";
import type { MeResponse, OtpRequestResponse } from "../api";
import { tokenStore } from "./tokens";

/** boot = hydrating from a stored token; ready = resolved (in or out). */
export type AuthStatus = "boot" | "ready";

/** The two shapes an OTP verify can settle into. `needsRegistration` means the
 * phone is new and the caller must collect a name and verify again. */
export interface VerifyOtpResult {
  needsRegistration: boolean;
  /** The signed-in user — only present when tokens were issued. */
  user: MeResponse | null;
}

export interface AuthContextValue {
  user: MeResponse | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  /**
   * "Just registered" signal (docs: post-register placement hop). Set true when the last
   * successful `verifyOtp` created an account (a `fullName` was supplied), so the app can route
   * a brand-new user into the one-time placement test instead of straight to Home. It is a
   * transient in-memory flag (not persisted): cleared by {@link clearJustRegistered} once the
   * placement screen has consumed it.
   */
  justRegistered: boolean;
  /** Clear the {@link justRegistered} signal (placement consumed it / user skipped). */
  clearJustRegistered: () => void;
  /** OTP step 1 — send a one-time code to the phone. Throws ApiError on 400. */
  requestOtp: (phone: string) => Promise<OtpRequestResponse>;
  /** OTP step 2 — verify the code. On a token pair it stores the tokens and
   * hydrates `user`; on a new phone it resolves `needsRegistration: true`
   * without storing anything. Throws ApiError on 401/403. */
  verifyOtp: (phone: string, code: string, fullName?: string) => Promise<VerifyOtpResult>;
  /** Clears tokens + user (best-effort server logout). */
  logout: () => void;
  /** Re-fetch `/me` into `user`. */
  loadMe: () => Promise<MeResponse>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<AuthStatus>(tokenStore.access ? "boot" : "ready");
  const [justRegistered, setJustRegistered] = useState(false);
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

  const requestOtp = useCallback((phone: string) => endpoints.otpRequest(phone), []);

  const verifyOtp = useCallback(
    async (phone: string, code: string, fullName?: string): Promise<VerifyOtpResult> => {
      const res = await endpoints.otpVerify(phone, code, fullName);
      if (isNeedsRegistration(res)) {
        return { needsRegistration: true, user: null };
      }
      // Token pair (login OR register) → persist + hydrate the user.
      tokenStore.set(res.access_token, res.refresh_token);
      const me = await endpoints.me(true);
      setUser(me);
      setStatus("ready");
      // A supplied name means this verify CREATED the account (register, or the
      // login→register fallback) — flag it so the app can route into placement.
      if (fullName && fullName.trim()) setJustRegistered(true);
      return { needsRegistration: false, user: me };
    },
    [],
  );

  const clearJustRegistered = useCallback(() => setJustRegistered(false), []);

  const logout = useCallback(() => {
    // Fire-and-forget: the .NET logout is a no-op (stateless JWT); ignore errors.
    endpoints.logout().catch(() => undefined);
    tokenStore.clear();
    setUser(null);
    setStatus("ready");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isAuthenticated: user !== null,
      justRegistered,
      clearJustRegistered,
      requestOtp,
      verifyOtp,
      logout,
      loadMe,
    }),
    [user, status, justRegistered, clearJustRegistered, requestOtp, verifyOtp, logout, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
