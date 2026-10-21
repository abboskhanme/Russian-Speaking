/**
 * app/nav — the bridge between the presentational `Nav` widget and the router.
 *
 * The 5 student screens are prop-driven: they render `studentNavItems` and call
 * `onNavigate(key)` on activation, and highlight `activeNavKey`. This module
 * maps those stable keys to routes (and back), so the widget drives real
 * `react-router` navigation without any routing coupling leaking into `widgets`.
 */
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { AdminNavKey, NavItem, StudentNavKey, TeacherNavKey } from "../widgets";

/** Route path for each of the 5 student nav destinations. The centre mic FAB
 * ("chat") owns the AI Suhbat surface at `/chat` — its OWN place, separate from
 * the Mashq hub (which is now just Modullar · Topshiriqlar). */
export const NAV_PATH: Record<StudentNavKey, string> = {
  home: "/",
  practice: "/practice",
  chat: "/chat",
  progress: "/progress",
  profile: "/profile",
};

/** Reverse lookup: pathname → nav key, for deriving the active nav state. */
export function navKeyForPath(pathname: string): StudentNavKey {
  const keys = Object.keys(NAV_PATH) as StudentNavKey[];
  // Exact match first ("/" must not be a prefix-match for every path).
  const exact = keys.find((k) => NAV_PATH[k] === pathname);
  if (exact) return exact;
  // Then longest non-root prefix (e.g. /practice/step-2 → practice).
  const prefix = keys
    .filter((k) => NAV_PATH[k] !== "/" && pathname.startsWith(NAV_PATH[k] + "/"))
    .sort((a, b) => NAV_PATH[b].length - NAV_PATH[a].length)[0];
  return prefix ?? "home";
}

/**
 * A router-bound `onNavigate` handler for the screens' `onNavigate` prop. Maps a
 * nav key back to its route and navigates.
 */
export function useNavHandler() {
  const navigate = useNavigate();
  return useCallback(
    (key: string, _item?: NavItem) => {
      const path = NAV_PATH[key as StudentNavKey];
      if (path) navigate(path);
    },
    [navigate],
  );
}

/* ── Teacher nav (Bosh · Klasslar · Navbat · Kontent · Analitika) ─────────── */

/**
 * Route path for each teacher nav destination — the mockup's own bar, not the
 * student one relabelled (see `teacherNavItems`). The teacher app lives under
 * its own `/teacher/*` space (so `/` stays the student home): a teacher who
 * lands on `/` is redirected here by {@link RoleHome}. All five destinations are
 * built as of Phase 6. A path with no route does NOT 404 here — it falls through
 * to the `*` catch-all and silently bounces to Obzor, which is exactly how
 * Analitika looked "broken" while its screen existed but its route did not. When
 * adding a destination, add the route in `App.tsx` in the same change.
 */
export const TEACHER_NAV_PATH: Record<TeacherNavKey, string> = {
  home: "/teacher",
  classes: "/teacher/classes",
  queue: "/teacher/queue",
  content: "/teacher/content",
  analytics: "/teacher/analytics",
};

/** Reverse lookup: pathname → teacher nav key, for the active nav state. */
export function teacherNavKeyForPath(pathname: string): TeacherNavKey {
  const keys = Object.keys(TEACHER_NAV_PATH) as TeacherNavKey[];
  // Exact match first ("/teacher" must not prefix-match every /teacher/* path).
  const exact = keys.find((k) => TEACHER_NAV_PATH[k] === pathname);
  if (exact) return exact;
  // Then longest prefix (e.g. /teacher/classes/:id → classes).
  const prefix = keys
    .filter((k) => pathname.startsWith(TEACHER_NAV_PATH[k] + "/"))
    .sort((a, b) => TEACHER_NAV_PATH[b].length - TEACHER_NAV_PATH[a].length)[0];
  return prefix ?? "home";
}

/** The teacher counterpart to {@link useNavHandler}: maps a teacher nav key back
 * to its `/teacher/*` route and navigates. */
export function useTeacherNavHandler() {
  const navigate = useNavigate();
  return useCallback(
    (key: string, _item?: NavItem) => {
      const path = TEACHER_NAV_PATH[key as TeacherNavKey];
      if (path) navigate(path);
    },
    [navigate],
  );
}

/**
 * Route path for each admin nav destination (`Govorim - Admin.dc.html`). The admin
 * app has its own `/admin/*` space for the same reason the teacher app does — a
 * shared route tree would force one panel's URLs onto the other. An admin who
 * lands on `/` is redirected here by {@link RoleHome}.
 *
 * The catch-all warning above applies here too: a missing route does not 404, it
 * bounces silently. Add the route in `App.tsx` in the same change.
 */
export const ADMIN_NAV_PATH: Record<AdminNavKey, string> = {
  home: "/admin",
  teachers: "/admin/teachers",
  students: "/admin/students",
  // The teacher's Kontent pages, run inside the admin shell (see app/contentPanel).
  content: "/admin/content",
  billing: "/admin/billing",
  // Jurnal — the audit trail. Sidebar-only in the nav; on a phone it opens from Boshqaruv.
  audit: "/admin/audit",
  settings: "/admin/settings",
};

/** The admin's own account — reached from the header avatar, not from the nav bar
 * (the admin bar has no Profil item, by design). */
export const ADMIN_PROFILE_PATH = "/admin/profile";

/** Reverse lookup: pathname → admin nav key, for the active nav state. */
export function adminNavKeyForPath(pathname: string): AdminNavKey {
  const keys = Object.keys(ADMIN_NAV_PATH) as AdminNavKey[];
  const exact = keys.find((k) => ADMIN_NAV_PATH[k] === pathname);
  if (exact) return exact;
  const prefix = keys
    .filter((k) => pathname.startsWith(ADMIN_NAV_PATH[k] + "/"))
    .sort((a, b) => ADMIN_NAV_PATH[b].length - ADMIN_NAV_PATH[a].length)[0];
  return prefix ?? "home";
}

/** Maps an admin nav key back to its `/admin/*` route and navigates. */
export function useAdminNavHandler() {
  const navigate = useNavigate();
  return useCallback(
    (key: string, _item?: NavItem) => {
      const path = ADMIN_NAV_PATH[key as AdminNavKey];
      if (path) navigate(path);
    },
    [navigate],
  );
}

/* ── Role layouts ───────────────────────────────────────────────────────────── */

/** The teacher's own account — reached from the header avatar (no nav item). */
export const TEACHER_PROFILE_PATH = "/teacher/profile";

/**
 * Screens that are not nav destinations but belong to one: the layout highlights
 * the item they were reached from. Prefix-matched (`/results/:id` → profile).
 */
export const STUDENT_NAV_ALIASES: Record<string, StudentNavKey> = {
  "/results": "profile",
  "/premium": "profile",
  "/group": "home",
  "/daily": "home",
  "/review": "practice",
  "/drill": "practice",
};
export const TEACHER_NAV_ALIASES: Record<string, TeacherNavKey> = {
  "/teacher/assign": "classes",
  "/teacher/students": "classes",
};

/**
 * The nav key a pathname belongs to: exact destination, then an alias, then the
 * longest non-root destination prefix. `undefined` when the page belongs to no
 * item (an account page reached from the avatar) — nothing is highlighted then,
 * rather than the role's home pretending to be the current page.
 */
export function activeKeyForPath<K extends string>(
  pathname: string,
  paths: Record<K, string>,
  aliases: Record<string, K> = {},
): K | undefined {
  const keys = Object.keys(paths) as K[];
  const exact = keys.find((k) => paths[k] === pathname);
  if (exact) return exact;
  const alias = Object.keys(aliases)
    .filter((p) => pathname === p || pathname.startsWith(p + "/"))
    .sort((a, b) => b.length - a.length)[0];
  if (alias) return aliases[alias];
  const root = Object.values<string>(paths).reduce((a, b) => (a.length <= b.length ? a : b));
  return keys
    .filter((k) => paths[k] !== "/" && paths[k] !== root && pathname.startsWith(paths[k] + "/"))
    .sort((a, b) => paths[b].length - paths[a].length)[0];
}
