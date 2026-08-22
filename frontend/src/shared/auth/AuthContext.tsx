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
import { SUPPORTED_LANGS, getLang, setLang } from "../i18n";
import type { AppLang } from "../i18n";
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
   * (by default) hydrates `user`; on a new phone it resolves
   * `needsRegistration: true` without storing anything. Throws ApiError on
   * 401/403. Pass `{ hydrate: false }` to store the tokens but DEFER flipping
   * `user`/`isAuthenticated` — the register flow uses this so its final "Manzil"
   * step can run before `PublicOnly` redirects the now-authed user to Home. */
  verifyOtp: (
    phone: string,
    code: string,
    fullName?: string,
    opts?: { hydrate?: boolean },
  ) => Promise<VerifyOtpResult>;
  /** Adopt a fetched `MeResponse` as the signed-in user (flips
   * `isAuthenticated`). Used to complete a deferred-hydration register once the
   * profile PATCH has returned the fresh user. */
  hydrateUser: (me: MeResponse) => void;
  /** Sign out. Returns immediately: this device forgets the session synchronously,
   * and the server-side revocation is posted behind it in a request that survives
   * the navigation. Never waits on the network. */
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
    async (
      phone: string,
      code: string,
      fullName?: string,
      opts?: { hydrate?: boolean },
    ): Promise<VerifyOtpResult> => {
      const res = await endpoints.otpVerify(phone, code, fullName);
      if (isNeedsRegistration(res)) {
        return { needsRegistration: true, user: null };
      }
      // Token pair (login OR register) → persist the tokens.
      tokenStore.set(res.access_token, res.refresh_token);
      // Deferred mode (register flow): tokens are stored so authed calls work,
      // but DON'T flip `user` yet — the "Manzil" step still has to run before
      // PublicOnly would bounce the now-authed user to Home.
      if (opts?.hydrate === false) {
        return { needsRegistration: false, user: null };
      }
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

  const hydrateUser = useCallback((me: MeResponse) => {
    setUser(me);
    setStatus("ready");
  }, []);

  /**
   * Adopt the ACCOUNT's language whenever identity resolves — boot, login, or any
   * `/me` refresh.
   *
   * The choice used to live only in each device's `localStorage`, so signing in
   * on a second device silently showed a language the user had already changed
   * away from. The server row is the source of truth for a signed-in user; the
   * local copy stays as the pre-login default and as the no-flash value while
   * `/me` is still in flight.
   *
   * Guarded on a real difference, so this never fights the profile's own switch:
   * that one applies the language immediately and then PATCHes, and by the time
   * `/me` comes back the two already agree.
   */
  useEffect(() => {
    const stored = user?.preferred_language;
    if (!stored || !(SUPPORTED_LANGS as readonly string[]).includes(stored)) return;
    if (stored === getLang()) return;
    setLang(stored as AppLang);
  }, [user]);

  const clearJustRegistered = useCallback(() => setJustRegistered(false), []);

  const logout = useCallback(() => {
    // Read the refresh token BEFORE clearing: it is what the server revokes, and
    // once the store is empty there is nothing left to name.
    const refreshToken = tokenStore.refresh;

    // Sign out locally first and synchronously. Logging out must never wait on a
    // network round trip — on a slow phone that is seconds of a screen that looks
    // like it ignored the tap, and the one thing the user asked for (this device
    // forgets me) does not depend on the server answering.
    tokenStore.clear();
    setUser(null);
    setStatus("ready");

    // ...then tell the server, in a request built to survive the navigation this
    // triggers (`keepalive`, see endpoints.logout). Errors are swallowed because
    // the local sign-out already happened and there is no second thing to try;
    // what is NOT acceptable is the request never leaving, which is what the old
    // plain fire-and-forget call risked every time.
    void endpoints.logout(refreshToken).catch(() => undefined);
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
      hydrateUser,
      logout,
      loadMe,
    }),
    [user, status, justRegistered, clearJustRegistered, requestOtp, verifyOtp, hydrateUser, logout, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
