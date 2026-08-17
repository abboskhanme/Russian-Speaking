/**
 * shared/api/client — the silent-refresh path.
 *
 * This is the single piece of app logic that decides whether a session survives.
 * Its failure modes are all invisible in review and expensive in production:
 *
 *   • no replay after a refresh  → the user is bounced to /login every hour;
 *   • replay without the `retried` latch → a genuinely dead session loops 401 →
 *     refresh → 401 forever, hammering the API;
 *   • a refresh that is not single-flight → the backend ROTATES refresh tokens, so
 *     a burst of parallel 401s (every screen fires several requests at once)
 *     exchanges the same token N times and all but one exchange is invalidated;
 *   • setting Content-Type on a FormData body → the browser cannot add the
 *     multipart boundary and every audio upload fails at the server's parser.
 *
 * `fetch` is stubbed rather than mocked at the module level so the assertions are
 * about the request that would actually go out over the wire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient, isApiError, request } from "./client";
import { tokenStore } from "../auth/tokens";

type Reply = { status: number; body?: unknown };

/** Queue of replies, consumed in order; the last one repeats. */
function stubFetch(replies: Reply[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const reply = replies[Math.min(i, replies.length - 1)];
    i += 1;
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: async () => (reply.body === undefined ? "" : JSON.stringify(reply.body)),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

/** jsdom's `location.assign` throws "Not implemented"; the redirect is an assertion target. */
let assigned: string[];

beforeEach(() => {
  assigned = [];
  vi.stubGlobal("location", {
    pathname: "/progress",
    assign: (url: string) => assigned.push(url),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("prefixes /api and attaches the bearer token", async () => {
    tokenStore.set("access-1", "refresh-1");
    const calls = stubFetch([{ status: 200, body: { ok: true } }]);

    await expect(request<{ ok: boolean }>("/auth/me")).resolves.toEqual({ ok: true });
    expect(calls[0].url).toBe("/api/auth/me");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer access-1");
  });

  it("omits the bearer for auth:false calls", async () => {
    tokenStore.set("access-1", "refresh-1");
    const calls = stubFetch([{ status: 200, body: {} }]);

    await request("/auth/config", { auth: false });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("leaves Content-Type off a FormData body", async () => {
    const calls = stubFetch([{ status: 200, body: {} }]);
    const form = new FormData();
    form.append("audio", new Blob(["x"]), "a.webm");

    await apiClient.post("/submissions", form);
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(calls[0].init.body).toBe(form);
  });

  it("sends JSON with an explicit Content-Type otherwise", async () => {
    const calls = stubFetch([{ status: 200, body: {} }]);
    await apiClient.post("/groups/join", { code: "ABC" });
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(calls[0].init.body).toBe('{"code":"ABC"}');
  });

  it("returns undefined for an empty 204 body", async () => {
    stubFetch([{ status: 204 }]);
    await expect(apiClient.post("/auth/logout")).resolves.toBeUndefined();
  });

  it("throws an ApiError carrying the server's detail", async () => {
    stubFetch([{ status: 402, body: { detail: "premium_required" } }]);
    const err = await request("/task").catch((e: unknown) => e);
    expect(isApiError(err)).toBe(true);
    if (!isApiError(err)) throw err;
    expect(err.status).toBe(402);
    expect(err.detail).toBe("premium_required");
  });

  it("reports a network failure as status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const err = await request("/auth/me").catch((e: unknown) => e);
    expect(isApiError(err) && err.status).toBe(0);
    expect(isApiError(err) && err.detail).toBe("network_error");
  });
});

describe("401 handling", () => {
  it("refreshes once and replays the original request", async () => {
    tokenStore.set("stale", "refresh-1");
    const calls = stubFetch([
      { status: 401, body: { detail: "expired" } },
      { status: 200, body: { access_token: "fresh", refresh_token: "refresh-2" } },
      { status: 200, body: { id: "u1" } },
    ]);

    await expect(request<{ id: string }>("/auth/me")).resolves.toEqual({ id: "u1" });

    expect(calls.map((c) => c.url)).toEqual(["/api/auth/me", "/api/auth/refresh", "/api/auth/me"]);
    // The replay must carry the NEW token, not the one that just 401'd.
    expect((calls[2].init.headers as Record<string, string>).Authorization).toBe("Bearer fresh");
    expect(tokenStore.access).toBe("fresh");
    expect(tokenStore.refresh).toBe("refresh-2");
    expect(assigned).toEqual([]);
  });

  it("exchanges the rotating refresh token exactly once for a burst of 401s", async () => {
    tokenStore.set("stale", "refresh-1");
    const calls = stubFetch([
      { status: 401, body: { detail: "expired" } },
      { status: 401, body: { detail: "expired" } },
      { status: 401, body: { detail: "expired" } },
      { status: 200, body: { access_token: "fresh", refresh_token: "refresh-2" } },
      { status: 200, body: { ok: true } },
    ]);

    await Promise.all([request("/a"), request("/b"), request("/c")]);

    expect(calls.filter((c) => c.url === "/api/auth/refresh")).toHaveLength(1);
  });

  it("gives up and redirects when the refresh is also rejected", async () => {
    tokenStore.set("stale", "dead-refresh");
    stubFetch([{ status: 401, body: { detail: "expired" } }]);

    await expect(request("/auth/me")).rejects.toThrow();
    expect(tokenStore.access).toBeNull();
    expect(assigned).toEqual(["/login"]);
  });

  it("does not loop when the replay 401s too", async () => {
    tokenStore.set("stale", "refresh-1");
    const calls = stubFetch([
      { status: 401, body: { detail: "expired" } },
      { status: 200, body: { access_token: "fresh", refresh_token: "refresh-2" } },
      { status: 401, body: { detail: "expired" } },
    ]);

    await expect(request("/auth/me")).rejects.toThrow();
    expect(calls.filter((c) => c.url === "/api/auth/refresh")).toHaveLength(1);
    expect(assigned).toEqual(["/login"]);
  });

  it("lets the login form surface its own 401 instead of redirecting", async () => {
    // Redirecting here would reload /login mid-submit and wipe the error message.
    stubFetch([{ status: 401, body: { detail: "invalid_code" } }]);
    await expect(
      request("/auth/otp/verify", { method: "POST", skipAuthRedirect: true }),
    ).rejects.toThrow();
    expect(assigned).toEqual([]);
  });

  it("never redirects away from the auth pages", async () => {
    vi.stubGlobal("location", { pathname: "/login", assign: (u: string) => assigned.push(u) });
    tokenStore.set("stale", "dead-refresh");
    stubFetch([{ status: 401, body: { detail: "expired" } }]);

    await expect(request("/auth/me")).rejects.toThrow();
    expect(assigned).toEqual([]);
  });
});
