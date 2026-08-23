/**
 * PremiumPage (`/premium`) — the student's subscription place.
 *
 *   • `GET  /api/billing/subscription` → the resolved premium state + both gate flags
 *   • `GET  /api/billing/plans`        → the tariffs on offer
 *   • `POST /api/billing/checkout`     → start a purchase (only reachable when both gates open)
 *
 * Reached from the profile's PRO card and from the paywall a 402 raises.
 *
 * **The checkout handler exists but is unreachable today**, and that is on purpose rather than an
 * oversight: with no merchant account the server answers 503 `provider_not_configured`, the screen
 * never renders a buy button, and the honest "payments are not connected" state is what a student
 * sees. The handler is wired anyway so that the day an adapter is registered, this page needs no
 * change — and if a deployment ever turns the flag on without one, the 503 surfaces as that same
 * message instead of a silent failure.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { PremiumScreen } from "../../screens/billing";
import type { PremiumPlan, PremiumSource, PremiumStatus } from "../../screens/billing";
import { endpoints, isApiError } from "../../shared/api";
import type { LinksResponse, PlanResponse, SubscriptionStatusResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

export default function PremiumPage() {
  const onNavigate = useNavHandler();
  const { t } = useTranslation();
  // The paywall sends people here with `state.reason = "paywall"`. Without it this screen would
  // appear out of nowhere mid-recording and leave the student to work out why.
  const { state } = useLocation() as { state?: { reason?: string } };
  const arrivedFromPaywall = state?.reason === "paywall";

  const [status, setStatus] = useState<SubscriptionStatusResponse | null>(null);
  const [plans, setPlans] = useState<PlanResponse[]>([]);
  const [links, setLinks] = useState<LinksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // What the last purchase attempt answered. Kept on screen rather than shown as a toast: this
  // is where "nothing was charged" is said, and a message that fades leaves the reader unsure.
  const [notice, setNotice] = useState<{ tone: "info" | "danger"; message: string } | null>(null);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    Promise.allSettled([
      endpoints.subscriptionStatus(),
      endpoints.billingPlans(),
      endpoints.settingsLinks(),
    ])
      .then(([s, p, l]) => {
        if (!alive) return;
        // The status is load-bearing: without it the screen cannot say whether this student has
        // premium, and guessing "no" at someone who is paying is the worse of the two errors.
        if (s.status !== "fulfilled") {
          setFailed(true);
          return;
        }
        setStatus(s.value);
        setPlans(p.status === "fulfilled" ? p.value : []);
        setLinks(l.status === "fulfilled" ? l.value : null);
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const buy = useCallback(
    async (planId: string) => {
      try {
        const result = await endpoints.billingCheckout({
          plan_id: planId,
          // One key per purchase attempt, resent verbatim by any retry — which is the ONLY thing
          // that makes the server's guard do anything. A key minted per REQUEST would de-duplicate
          // nothing.
          idempotency_key: crypto.randomUUID(),
        });
        if (result.redirect_url) {
          window.location.assign(result.redirect_url);
          return;
        }
        // No redirect and no error: the provider accepted but has nowhere to send the payer yet.
        // Say the attempt is pending rather than implying it succeeded — nothing has been charged.
        setNotice({ tone: "info", message: t("billing.checkoutPending") });
      } catch (err) {
        // 503 is the honest refusal, not a failure: payments off, or no provider wired up. It is
        // reported as the same "not connected yet" sentence the banner uses, because it is the
        // same fact — never as "purchase failed", which implies one was attempted and lost.
        setNotice(
          isApiError(err) && err.status === 503
            ? { tone: "info", message: t("billing.notConnected.short") }
            : { tone: "danger", message: t("billing.checkoutFailed") },
        );
      } finally {
        // Whatever happened, re-read the state from the server rather than assuming. This screen
        // must never show a subscription the server has not actually granted.
        refetch();
      }
    },
    [refetch, t],
  );

  if (loading) return <PageLoading />;
  if (failed || !status) return <PageError onRetry={refetch} />;

  const uiStatus: PremiumStatus = {
    isPremium: status.is_premium,
    source: status.source as PremiumSource,
    status: status.status,
    planName: status.plan?.name ?? null,
    endsAt: status.ends_at,
    paymentsEnabled: status.payments_enabled,
    providerConfigured: status.provider_configured,
  };

  const uiPlans: PremiumPlan[] = plans.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    priceMinor: p.price_minor,
    currency: p.currency,
    durationDays: p.duration_days,
  }));

  return (
    <PremiumScreen
      status={uiStatus}
      plans={uiPlans}
      supportUrl={links?.tg_support_url || null}
      notice={
        notice ?? (arrivedFromPaywall ? { tone: "info", message: t("practice.paywall") } : null)
      }
      activeNavKey="profile"
      onNavigate={onNavigate}
      onBuy={buy}
    />
  );
}
