/**
 * `justRegistered` — raised for a brand-new account on EITHER way in, and only then.
 *
 * The register form stores its tokens with `hydrate: false` (so the "Manzil" step
 * can run) and finishes in `hydrateUser`. That path never raised the signal, so a
 * student who registered the main way was never offered placement. And a named
 * verify is not proof of a new account — the server signs a KNOWN phone in whatever
 * name is sent — so the account's own `created_at` decides.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { MeResponse } from "../api";
import { AuthProvider, isFreshAccount, useAuth } from "./AuthContext";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    endpoints: {
      ...actual.endpoints,
      otpVerify: () =>
        Promise.resolve({ access_token: "a", refresh_token: "r", token_type: "bearer" }),
    },
  };
});

function me(createdAt: string): MeResponse {
  return {
    id: "u1",
    email: "x@govori.uz",
    full_name: "Aziz Karimov",
    role: "student",
    is_active: true,
    is_premium: false,
    region: null,
    district: null,
    address: null,
    phone: "+998901234567",
    created_at: createdAt,
    level: null,
    level_label: null,
    avatar_url: null,
    notifications_enabled: true,
    preferred_language: "uz",
  };
}

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

afterEach(() => {
  localStorage.clear();
});

describe("the register form's deferred flow", () => {
  it("raises the signal when it completes on a brand-new account", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.verifyOtp("+998901234567", "123456", "Aziz Karimov", { hydrate: false });
    });
    expect(result.current.justRegistered).toBe(false); // not until the flow ends

    act(() => result.current.hydrateUser(me(new Date().toISOString())));
    expect(result.current.justRegistered).toBe(true);
  });

  it("does not raise it for a known phone that was merely signed in", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.verifyOtp("+998901234567", "123456", "Aziz Karimov", { hydrate: false });
    });
    act(() => result.current.hydrateUser(me("2025-01-01T00:00:00Z")));
    expect(result.current.justRegistered).toBe(false);
  });
});

describe("isFreshAccount", () => {
  it("counts only an account created in the last few minutes", () => {
    const now = Date.parse("2026-09-29T10:00:00Z");
    expect(isFreshAccount(me("2026-09-29T09:58:00Z"), now)).toBe(true);
    expect(isFreshAccount(me("2026-09-28T10:00:00Z"), now)).toBe(false);
    expect(isFreshAccount(me("not a date"), now)).toBe(false);
  });
});
