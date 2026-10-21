/**
 * app/features — where the feature switches (`useFeatures`) meet the router and
 * the nav.
 *
 *   navItemsFor      — a role's nav items with switched-off destinations left out
 *                      (today: AI Suhbat while `roleplay` is off). The role layout
 *                      draws both bars from it, so this one filter covers both.
 *   RequireFeature   — guards a flag-gated route. A student who reaches it
 *                      anyway (an old bookmark, a notification) is sent to the
 *                      page they most plausibly wanted, never shown an
 *                      operator's explanation of why the feature is off.
 */
import type { TFunction } from "i18next";
import { Navigate, Outlet } from "react-router-dom";
import { useFeatures } from "../shared/auth";
import type { Features } from "../shared/auth";
import { adminNavItems, studentNavItems, teacherNavItems } from "../widgets";
import type { NavItem } from "../widgets";

/** Nav keys hidden for a given set of switches. Student keys only — the teacher
 * and admin bars have no flag-gated destinations. */
export function hiddenNavKeys(
  features: Pick<Features, "roleplay">,
  role: string | undefined,
): ReadonlySet<string> {
  const hidden = new Set<string>();
  if (role === "student" && !features.roleplay) hidden.add("chat");
  return hidden;
}

export type NavRole = "student" | "teacher" | "admin";

/** The role's nav items — the ONE list the sidebar and the bottom bar both draw —
 * minus whatever the feature switches turn off. */
export function navItemsFor(
  role: NavRole,
  t: TFunction,
  { queued = 0, features }: { queued?: number; features: Pick<Features, "roleplay"> },
): NavItem[] {
  const items =
    role === "teacher" ? teacherNavItems(t, queued) : role === "admin" ? adminNavItems(t) : studentNavItems(t);
  const hidden = hiddenNavKeys(features, role);
  return items.filter((item) => !hidden.has(item.key));
}

export type FeatureKey = keyof Omit<Features, "ai_available">;

/** Renders the child routes only while `feature` is on; otherwise redirects
 * (replace, so Back does not bounce the student into the redirect again). */
export function RequireFeature({ feature, fallback }: { feature: FeatureKey; fallback: string }) {
  const features = useFeatures();
  if (!features[feature]) return <Navigate to={fallback} replace />;
  return <Outlet />;
}
