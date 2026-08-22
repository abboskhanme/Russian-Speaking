/**
 * shared/api/client — the single typed `fetch` wrapper the whole app calls.
 *
 * Contract (docs/08 auth slice, priority #1):
 *   • Base URL is the RELATIVE `/api` — the dockerized frontend (nginx) reverse-
 *     proxies `/api/*` to the .NET API, so there is no host/port/CORS concern.
 *   • JSON in / JSON out by default; pass a `FormData` body for multipart
 *     (the browser sets the `multipart/form-data` boundary — we must NOT).
 *   • Attaches `Authorization: Bearer <access>` from the token store when a
 *     token exists (skip with `auth: false` for the login/register calls).
 *   • Throws a typed {@link ApiError} on any non-2xx, carrying the status + the
 *     `{ detail }` message the API returns, so callers can branch on 401/403/402…
 *   • On a 401 for an authenticated request it first tries a SILENT REFRESH
 *     (exchange the stored refresh token for a fresh pair via `/auth/refresh`)
 *     and replays the request once. Only if the refresh also fails does it clear
 *     the tokens and redirect to `/login`, UNLESS `skipAuthRedirect` is set (the
 *     login form + boot `/me` surface their own 401). So the session lasts the
 *     refresh token's lifetime (7 days, and sliding — every refresh reissues it).
 */
import { tokenStore } from "../auth/tokens";
import type { TokenResponse } from "./types";

export const API_BASE = "/api";

export interface ApiError extends Error {
  /** HTTP status (0 = network/parse failure before a response). */
  status: number;
  /** The server's `{ detail }` message when present, else a generic string. */
  detail: string;
  /** The raw parsed body, for the rare caller that needs more than `detail`. */
  body: unknown;
}

/** Build a typed ApiError (a plain Error subclass carrying status + detail). */
function makeApiError(status: number, detail: string, body: unknown): ApiError {
  const err = new Error(detail) as ApiError;
  err.name = "ApiError";
  err.status = status;
  err.detail = detail;
  err.body = body;
  return err;
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && e.name === "ApiError";
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** JSON-serializable body, OR a `FormData` for multipart uploads. */
  body?: unknown;
  /** Extra headers merged over the defaults. */
  headers?: Record<string, string>;
  /** Attach the bearer token (default true). */
  auth?: boolean;
  /** Don't redirect to /login on a 401 — throw instead (login + boot /me). */
  skipAuthRedirect?: boolean;
  /** AbortSignal for cancellable polls. */
  signal?: AbortSignal;
  /**
   * Let the request outlive the page that started it. The browser normally kills
   * in-flight requests when the document unloads or the SPA tears the caller down,
   * which is how a fire-and-forget call made on the way out (logout) reaches the
   * server only sometimes. `keepalive` hands it to the browser to finish
   * regardless — bounded to a 64KB body, which is why it is opt-in per call.
   *
   * Ignored by browsers that don't implement it (an unknown `RequestInit` key is
   * dropped), so the request still goes out — just cancellably, as before.
   */
  keepalive?: boolean;
  /** @internal Marks the single automatic replay after a silent token refresh,
   * so a second 401 doesn't loop. Callers never set this. */
  retried?: boolean;
}

function redirectToLogin(): void {
  tokenStore.clear();
  // Guard against a redirect loop if we're already on the auth pages.
  const path = window.location.pathname;
  if (path !== "/login" && path !== "/register") {
    window.location.assign("/login");
  }
}

/** In-flight refresh, so a burst of 401s triggers exactly ONE token exchange. */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Exchange the stored refresh token for a fresh access + refresh pair (the
 * backend rotates both). Single-flight. Resolves `true` when the tokens were
 * renewed, `false` when there's no refresh token or the server rejected it
 * (expired / invalid) — in which case the session is genuinely over.
 */
function tryRefresh(): Promise<boolean> {
  const rt = tokenStore.refresh;
  if (!rt) return Promise.resolve(false);
  if (!refreshInFlight) {
    // `auth: false` (no bearer) + `skipAuthRedirect` so this call never itself
    // recurses into a refresh, and a rejected refresh token doesn't redirect here.
    refreshInFlight = request<TokenResponse>("/auth/refresh", {
      method: "POST",
      body: { refresh_token: rt },
      auth: false,
      skipAuthRedirect: true,
    })
      .then((res) => {
        tokenStore.set(res.access_token, res.refresh_token);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/**
 * The core request. Returns the parsed JSON body typed as `T` (or `undefined`
 * for 204 / empty responses). Throws {@link ApiError} on non-2xx.
 */
export async function request<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    body,
    headers = {},
    auth = true,
    skipAuthRedirect = false,
    signal,
    keepalive = false,
    retried = false,
  } = opts;

  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const finalHeaders: Record<string, string> = { Accept: "application/json", ...headers };

  let payload: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (isForm) {
      payload = body as FormData; // browser sets Content-Type + boundary
    } else {
      finalHeaders["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }

  if (auth) {
    const token = tokenStore.access;
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: finalHeaders,
      body: payload,
      signal,
      keepalive,
    });
  } catch (e) {
    // Network failure / abort — no HTTP status.
    if ((e as Error)?.name === "AbortError") throw e;
    throw makeApiError(0, "network_error", e);
  }

  // Parse the body once (JSON when possible, else text).
  const raw = await res.text();
  let parsed: unknown = undefined;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && auth) {
      // Access token likely expired → silently refresh and replay ONCE. Only a
      // failed refresh (or a second 401) means the session is really over.
      if (!retried) {
        const refreshed = await tryRefresh();
        if (refreshed) return request<T>(path, { ...opts, retried: true });
      }
      if (!skipAuthRedirect) redirectToLogin();
    }
    const detail =
      (parsed && typeof parsed === "object" && "detail" in parsed
        ? String((parsed as { detail: unknown }).detail)
        : undefined) ?? `http_${res.status}`;
    throw makeApiError(res.status, detail, parsed);
  }

  return parsed as T;
}

export const apiClient = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "PATCH", body }),
  del: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: "DELETE" }),
};
