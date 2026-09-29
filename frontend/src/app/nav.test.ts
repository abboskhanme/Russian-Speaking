/**
 * app/nav ↔ App.tsx — every nav destination must have a route.
 *
 * WHY THIS EXISTS. `App.tsx` ends in `<Route path="*" element={<Navigate to="/" />} />`,
 * so a nav item pointing at a path with no route does NOT 404 — it silently
 * bounces to the role home. That is precisely how Analitika shipped "broken":
 * the screen existed, the nav item existed, the route did not, and clicking it
 * just went back to Obzor. Nothing in tsc, the build or a screenshot can see it,
 * because every individual piece is correct.
 *
 * The check reads `App.tsx` as TEXT rather than rendering the router, because the
 * routes are inline JSX with no exported table to introspect, and mounting the
 * tree would drag in the auth context and 30 lazy chunks to answer a question
 * about strings. Same posture as `scripts/check-tokens.mjs`.
 */
import { describe, expect, it } from "vitest";
// Vite's `?raw` rather than `node:fs`: under Vitest `import.meta.url` is a module-
// runner URL, not a `file:` one, so path arithmetic off it throws.
import appSource from "../App.tsx?raw";
import { ADMIN_NAV_PATH, ADMIN_PROFILE_PATH, NAV_PATH, TEACHER_NAV_PATH } from "./nav";

/** Every `path="…"` literal declared in the router. */
const ROUTED = new Set([...appSource.matchAll(/path="([^"]+)"/g)].map(([, path]) => path));

describe("route coverage", () => {
  it("finds the router's own paths, so the sweep below is not vacuous", () => {
    expect(ROUTED.has("/login")).toBe(true);
    expect(ROUTED.has("*")).toBe(true);
    expect(ROUTED.size).toBeGreaterThan(20);
  });

  it.each([
    ["student", NAV_PATH],
    ["teacher", TEACHER_NAV_PATH],
    ["admin", ADMIN_NAV_PATH],
  ])("routes every %s nav destination", (_role, table) => {
    const unrouted = Object.entries(table)
      .filter(([, path]) => !ROUTED.has(path))
      .map(([key, path]) => `${key} → ${path}`);
    expect(unrouted).toEqual([]);
  });

  it("routes the admin destinations that are not nav items", () => {
    // Reached from the header avatar and from a Kontent row — neither is in the bar,
    // so the sweep above cannot see them, and a missing one bounces to the admin home.
    expect(ROUTED.has(ADMIN_PROFILE_PATH)).toBe(true);
    expect(ROUTED.has(`${ADMIN_NAV_PATH.content}/:blockId`)).toBe(true);
  });
});

describe("nav tables", () => {
  it("keeps the three apps in separate URL spaces", () => {
    // A shared prefix would put one panel's catch-all in front of the other's
    // routes; `/` staying the student home is what makes RoleHome work.
    expect(Object.values(TEACHER_NAV_PATH).every((p) => p.startsWith("/teacher"))).toBe(true);
    expect(Object.values(ADMIN_NAV_PATH).every((p) => p.startsWith("/admin"))).toBe(true);
    expect(Object.values(NAV_PATH).some((p) => p.startsWith("/teacher") || p.startsWith("/admin"))).toBe(
      false,
    );
  });

  it("gives each destination its own path", () => {
    for (const table of [NAV_PATH, TEACHER_NAV_PATH, ADMIN_NAV_PATH]) {
      const paths = Object.values(table);
      expect(new Set(paths).size).toBe(paths.length);
    }
  });
});
