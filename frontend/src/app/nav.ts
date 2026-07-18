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
import type { NavItem, StudentNavKey } from "../widgets";

/** Route path for each of the 5 student nav destinations. */
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
