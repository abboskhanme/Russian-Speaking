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

/** How recently an account must have been created for a named verify to count as
 * a REGISTRATION. Generous, because it compares the server's clock with this one. */
const FRESH_ACCOUNT_MS = 15 * 60 * 1000;

/**
 * Whether `me` is an account that was created just now.
 *
 * A verify that carries a name is not proof of a new account: the server treats a
 * KNOWN phone as a login whatever else is sent, so someone who goes through the
 * register form with a number they already use is simply signed in. Without this
 * check that person would be pushed into the new-student placement test. The
 * account's own `created_at` is the fact that settles it.
 */
export function isFreshAccount(me: MeResponse, now: number = Date.now()): boolean {
  const created = Date.parse(me.created_at);
  return Number.isFinite(created) && now - created < FRESH_ACCOUNT_MS;
}

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
   * successful sign-in CREATED an account — a name was supplied AND the account is brand new
   * ({@link isFreshAccount}) — on either path: the register form (raised in `hydrateUser`, at the
   * end of its deferred flow) or the login→register fallback (raised in `verifyOtp`). `RoleHome`
   * reads it and sends the new student to the one-time placement test instead of straight to
   * Home. A transient in-memory flag (not persisted): cleared by {@link clearJustRegistered} as
   * that hop is taken, and by `logout`.
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
  /** A deferred (`hydrate: false`) verify carried a name — the register form's path.
   * `hydrateUser` settles whether that created an account once the user is known. */
  const registering = useRef(false);
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
        // The register form's path: the flag is decided when the flow completes.
        registering.current = Boolean(fullName && fullName.trim());
        return { needsRegistration: false, user: null };
      }
      const me = await endpoints.me(true);
      setUser(me);
      setStatus("ready");
      // A supplied name on a brand-new account means this verify CREATED it (the
      // login→register fallback) — flag it so the app routes into placement.
      if (fullName && fullName.trim() && isFreshAccount(me)) setJustRegistered(true);
      return { needsRegistration: false, user: me };
    },
    [],
  );

  const hydrateUser = useCallback((me: MeResponse) => {
    setUser(me);
    setStatus("ready");
    // The deferred register flow ends here (after its "Manzil" step). This used to
    // be the one path that never raised the signal, so a student who registered
    // through the three-step form — the main way in — was never offered placement.
    if (registering.current) {
      registering.current = false;
      if (isFreshAccount(me)) setJustRegistered(true);
    }
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
    if (!user) return;
    const stored = user.preferred_language;
    if (!stored || !(SUPPORTED_LANGS as readonly string[]).includes(stored)) return;
    const local = getLang();
    if (stored === local) return;
    // Except for an account created a moment ago on THIS device: it carries the
    // server default (uz), while the person just chose their language with the
    // switcher on the login/register page. That choice wins and is saved to the
    // account (best-effort — the next sign-in re-reads the server anyway).
    if (justRegistered) {
      setUser({ ...user, preferred_language: local });
      endpoints.updateProfile({ preferred_language: local }).catch(() => {});
      return;
    }
    setLang(stored as AppLang);
  }, [user, justRegistered]);

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
    setJustRegistered(false);
    registering.current = false;

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

/** The auth context, or null outside an {@link AuthProvider} (a screen gallery,
 * an isolated test). For readers that have a sensible signed-out answer. */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
