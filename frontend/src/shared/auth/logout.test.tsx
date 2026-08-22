/**
 * Signing out — the two halves that have to be true at the same time.
 *
 * WHY THIS IS TESTED. Revocation lives on the server (a Redis deny-list keyed on the
 * refresh token), and the client is the only thing that can name the token to revoke.
 * Both ways of getting that wrong are silent:
 *
 *   • **Send no token** and `POST /auth/logout` answers 204 having revoked nothing.
 *     The seven-day refresh token stays valid, so "Chiqish" on a shared phone is a
 *     local gesture and the next person can still reach the account. Nothing in the
 *     UI, the network tab or the server log looks wrong.
 *   • **Wait for the response** and the browser is free to cancel the request as the
 *     sign-out navigation tears the page down — again, 100% of the visible behaviour
 *     is correct and the token lives on.
 *
 * So the assertions are: the token IS in the body, the request is `keepalive`, and
 * the local sign-out completes without the network settling at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { logout as logoutRequest } from "../api/endpoints";
import { AuthProvider, useAuth } from "./AuthContext";
import { tokenStore } from "./tokens";

interface Call {
  url: string;
  init: RequestInit;
}

/** Records every request; answers `/auth/me` and leaves `/auth/logout` PENDING. */
function stubFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      // Never settles. Any assertion that passes below therefore passed WITHOUT the
      // server answering — which is the property under test.
      if (url.endsWith("/auth/logout")) return new Promise<Response>(() => {});
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "u1", full_name: "Ali", role: "student" }),
      } as unknown as Response);
    }),
  );
  return calls;
}

const body = (call: Call) => JSON.parse(String(call.init.body ?? "null"));

beforeEach(() => {
  vi.stubGlobal("location", { pathname: "/profile", assign: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("endpoints.logout", () => {
  it("names the token the server is meant to revoke", async () => {
    const calls = stubFetch();
    void logoutRequest("refresh-abc");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/auth/logout");
    expect(calls[0].init.method).toBe("POST");
    expect(body(calls[0])).toEqual({ refresh_token: "refresh-abc" });
  });

  it("marks the request keepalive so a navigation cannot cancel it", () => {
    const calls = stubFetch();
    void logoutRequest("refresh-abc");
    expect(calls[0].init.keepalive).toBe(true);
  });

  it("still posts when there is no token to send", () => {
    // Reachable: the tokens were already cleared by a 401, or the session was only
    // ever half-established. A throw here would break signing out entirely.
    const calls = stubFetch();
    expect(() => void logoutRequest(null)).not.toThrow();
    expect(calls).toHaveLength(1);
    expect(calls[0].init.body).toBeUndefined();
  });
});

function Consumer() {
  const { isAuthenticated, logout } = useAuth();
  return (
    <>
      <p>{isAuthenticated ? "kirgan" : "chiqqan"}</p>
      <button onClick={logout}>Chiqish</button>
    </>
  );
}

describe("AuthContext.logout", () => {
  it("signs out locally without waiting for the server, and still sends the token", async () => {
    const calls = stubFetch();
    tokenStore.set("access-1", "refresh-1");

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );
    // Boot hydration resolves `/me` → signed in.
    expect(await screen.findByText("kirgan")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Chiqish" }));

    // The logout response never comes (see stubFetch) — and none of this waited on it.
    expect(screen.getByText("chiqqan")).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();

    // ...and the refresh token still went out, read before the store was cleared.
    const sent = calls.find((c) => c.url.endsWith("/auth/logout"));
    expect(sent).toBeDefined();
    expect(body(sent!)).toEqual({ refresh_token: "refresh-1" });
  });
});
