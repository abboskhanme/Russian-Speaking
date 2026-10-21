/**
 * app/features — where the feature switches (`useFeatures`) meet the router and
 * the nav.
 *
 *   FeatureNavFilter — hides a switched-off destination from every Nav (today:
 *                      AI Suhbat while `roleplay` is off).
 *   RequireFeature   — guards a flag-gated route. A student who reaches it
 *                      anyway (an old bookmark, a notification) is sent to the
 *                      page they most plausibly wanted, never shown an
 *                      operator's explanation of why the feature is off.
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth, useFeatures } from "../shared/auth";
import type { Features } from "../shared/auth";
import { NavHiddenKeysContext } from "../widgets";

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

export function FeatureNavFilter({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { roleplay } = useFeatures();
  const role = user?.role;
  // Keyed on the inputs, so every Nav does not re-render on each /me refresh.
  const hidden = useMemo(() => hiddenNavKeys({ roleplay }, role), [roleplay, role]);
  return <NavHiddenKeysContext.Provider value={hidden}>{children}</NavHiddenKeysContext.Provider>;
}

export type FeatureKey = keyof Omit<Features, "ai_available">;

/** Renders the child routes only while `feature` is on; otherwise redirects
 * (replace, so Back does not bounce the student into the redirect again). */
export function RequireFeature({ feature, fallback }: { feature: FeatureKey; fallback: string }) {
  const features = useFeatures();
  if (!features[feature]) return <Navigate to={fallback} replace />;
  return <Outlet />;
}
