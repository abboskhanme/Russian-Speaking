/**
 * shared/auth/tokens — the session's storage contract.
 *
 * `govori_access` / `govori_refresh` are not private implementation detail: the
 * e2e suite and the headless-screenshot recipe both AUTHENTICATE by writing those
 * two keys before the SPA boots. Renaming either leaves the app working and every
 * automated run silently signed out, landing on /login and screenshotting it as
 * though it were the page under test.
 */
import { describe, expect, it } from "vitest";
import { tokenStore } from "./tokens";

describe("tokenStore", () => {
  it("uses the storage keys the e2e/screenshot tooling injects", () => {
    tokenStore.set("A", "R");
    expect(localStorage.getItem("govori_access")).toBe("A");
    expect(localStorage.getItem("govori_refresh")).toBe("R");
  });

  it("reads back what it wrote", () => {
    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();
    tokenStore.set("A", "R");
    expect(tokenStore.access).toBe("A");
    expect(tokenStore.refresh).toBe("R");
  });

  it("keeps the refresh token when only the access token is rotated", () => {
    // A silent refresh that also dropped the refresh token would log the user out
    // exactly one access-token lifetime later, which reads as a random logout.
    tokenStore.set("A", "R");
    tokenStore.setAccess("A2");
    expect(tokenStore.access).toBe("A2");
    expect(tokenStore.refresh).toBe("R");
  });

  it("clears both on logout", () => {
    tokenStore.set("A", "R");
    tokenStore.clear();
    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();
  });
});
