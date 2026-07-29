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
import type { NavItem, StudentNavKey, TeacherNavKey } from "../widgets";

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
 * lands on `/` is redirected here by {@link RoleHome}. Only `home` (A1 Obzor) is
 * built in Phase 1 — the rest arrive with their screens (Phases 2–6); until then
 * they resolve to the catch-all and bounce back to Obzor.
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
