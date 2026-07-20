/**
 * shared/auth/tokens — the token store (docs/08 auth slice).
 *
 * The access + refresh tokens are persisted to `localStorage` so a reload keeps
 * the session. This module is React-free on purpose: the API client imports it
 * directly to attach the `Authorization` header and to clear tokens on a 401,
 * without depending on React context.
 */

const ACCESS_KEY = "govori_access";
const REFRESH_KEY = "govori_refresh";

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  /** Persist a fresh access + refresh pair. */
  set(access: string, refresh: string): void {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  /** Replace only the access token (after a silent refresh). */
  setAccess(access: string): void {
    localStorage.setItem(ACCESS_KEY, access);
  },
  /** Drop both tokens (logout / 401). */
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};
