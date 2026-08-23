/**
 * AdminBillingPage (`/admin/billing`) — Tariflar.
 *
 *   • `GET    /api/admin/billing/plans`          → every tariff, retired ones included
 *   • `POST   /api/admin/billing/plans`          → create
 *   • `PATCH  /api/admin/billing/plans/{id}`     → partial update
 *   • `DELETE /api/admin/billing/plans/{id}`     → refused for a tariff anything was sold under
 *   • `GET    /api/admin/billing/subscriptions`  → who holds what, read-only
 *   • `GET    /api/billing/subscription`         → the two GATE states, for the banner
 *
 * The last one is the odd read on this page and it is deliberate. The admin's own subscription
 * status is irrelevant here; what the page needs from it are `payments_enabled` and
 * `provider_configured`, which is where the server reports both, and the banner that tells an
 * admin their tariffs are not actually on sale is the most important thing on the screen.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminBillingScreen } from "../../screens/admin";
import type { AdminPlan, AdminPlanDraft, AdminSubscriptionRow } from "../../screens/admin";
import { endpoints } from "../../shared/api";
import type {
  AdminSubscriptionResponse,
  PlanResponse,
  SubscriptionStatusResponse,
} from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useAdminNavHandler } from "../nav";

export default function AdminBillingPage() {
  const onNavigate = useAdminNavHandler();

  const [plans, setPlans] = useState<PlanResponse[]>([]);
  const [subs, setSubs] = useState<AdminSubscriptionResponse[]>([]);
  const [gates, setGates] = useState<SubscriptionStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    Promise.allSettled([
      endpoints.adminPlans(),
      endpoints.adminSubscriptions(),
      endpoints.subscriptionStatus(),
    ])
      .then(([p, s, g]) => {
        if (!alive) return;
        // The plans are load-bearing; the other two are not. A failing subscriptions read costs
        // that list its rows, not the page.
        if (p.status !== "fulfilled") {
          setFailed(true);
          return;
        }
        setPlans(p.value);
        setSubs(s.status === "fulfilled" ? s.value : []);
        setGates(g.status === "fulfilled" ? g.value : null);
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const uiPlans = useMemo<AdminPlan[]>(
    () =>
      plans.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        priceMinor: p.price_minor,
        currency: p.currency,
        durationDays: p.duration_days,
        active: p.is_active,
        sortOrder: p.sort_order,
      })),
    [plans],
  );

  const uiSubs = useMemo<AdminSubscriptionRow[]>(
    () =>
      subs.map((s) => ({
        id: s.id,
        userName: s.user_name,
        userEmail: s.user_email,
        planName: s.plan_name,
        status: s.status,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        provider: s.provider,
        teacherGranted: s.teacher_granted,
      })),
    [subs],
  );

  // The write path refetches rather than patching state locally: the server normalises the code
  // (lower-cases it) and can reject a duplicate, so echoing the draft back would show the admin a
  // tariff that is not the one that was stored.
  const create = useCallback(
    async (draft: AdminPlanDraft) => {
      await endpoints.adminCreatePlan(toArgs(draft));
      refetch();
    },
    [refetch],
  );

  const update = useCallback(
    async (id: string, draft: AdminPlanDraft) => {
      await endpoints.adminUpdatePlan(id, toArgs(draft));
      refetch();
    },
    [refetch],
  );

  const remove = useCallback(
    async (id: string) => {
      await endpoints.adminDeletePlan(id);
      refetch();
    },
    [refetch],
  );

  if (loading) return <PageLoading />;
  if (failed) return <PageError onRetry={refetch} />;

  return (
    <AdminBillingScreen
      plans={uiPlans}
      subscriptions={uiSubs}
      // Default to BOTH gates shut when the status read failed. An unknown state must never
      // render as "payments are live" — the banner would vanish and the admin would conclude
      // their tariffs are on sale.
      paymentsEnabled={gates?.payments_enabled ?? false}
      providerConfigured={gates?.provider_configured ?? false}
      activeNavKey="billing"
      onNavigate={onNavigate}
      onCreate={create}
      onUpdate={update}
      onDelete={remove}
    />
  );
}

function toArgs(draft: AdminPlanDraft) {
  return {
    code: draft.code,
    name: draft.name,
    // "" clears the description; the server trims it to null.
    description: draft.description,
    price_minor: draft.priceMinor,
    duration_days: draft.durationDays,
    is_active: draft.active,
  };
}
