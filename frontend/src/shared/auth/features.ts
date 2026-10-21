/**
 * shared/auth/features — the ONE place the client learns which flag-gated
 * student surfaces this deployment offers.
 *
 * The switches arrive on `GET /api/auth/me` (`features`), which the auth store
 * already loads at boot, so asking costs no request. This replaces the old habit
 * of probing each feature's route (`/api/daily`, `/api/review/drill`) and reading
 * a 404 as "off" — which put a red error in the console on every Home and Mashq
 * load for every student of a deployment that had the feature off.
 *
 * The answer is advisory: every route still enforces its own flag server-side,
 * so a stale value costs a hidden or refused button, never access.
 */
import { useOptionalAuth } from "./AuthContext";
import type { ClientFeatures, MeResponse } from "../api";

export type Features = Readonly<ClientFeatures>;

/** What a user object without a `features` block (signed out, or a server that
 * predates it) means: nothing optional is offered. AI is not "off" — its budget
 * is enforced per call, and claiming an outage nobody reported would be wrong. */
export const NO_FEATURES: Features = Object.freeze({
  roleplay: false,
  daily_five: false,
  review_drill: false,
  phoneme_drill: false,
  payments: false,
  ai_available: true,
});

/** The feature switches of a `/me` answer, defaulted field by field. */
export function featuresOf(me: Pick<MeResponse, "features"> | null | undefined): Features {
  const f = me?.features;
  if (!f) return NO_FEATURES;
  return {
    roleplay: f.roleplay === true,
    daily_five: f.daily_five === true,
    review_drill: f.review_drill === true,
    phoneme_drill: f.phoneme_drill === true,
    payments: f.payments === true,
    ai_available: f.ai_available !== false,
  };
}

/** The signed-in user's feature switches (see {@link featuresOf}). Outside an
 * AuthProvider it answers {@link NO_FEATURES} rather than throwing, so an
 * isolated screen renders its switched-off shape. */
export function useFeatures(): Features {
  return featuresOf(useOptionalAuth()?.user);
}
