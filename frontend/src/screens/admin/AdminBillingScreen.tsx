import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Badge, Button, Card, Input, Modal, Switch, Text } from "../../shared/ui";
import type { BadgeVariant } from "../../shared/ui";
import { isApiError } from "../../shared/api";
import { formatMinor, parseMajorToMinor } from "../../shared/money";
import { AppShell, Brand, NotificationsBell, adminNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { AdminAccountButton } from "./AdminChrome";
import { isNetworkError } from "./adminErrors";
import { mockAdminPlans, mockAdminSubscriptions } from "./adminBilling.mock";
import { formatDate } from "../../shared/format/date";
import styles from "./AdminBillingScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** One tariff. `priceMinor` is TIYIN — a whole number, never so'm and never a float
 * (see `shared/money`). */
export interface AdminPlan {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  priceMinor: number;
  currency: string;
  durationDays: number;
  active: boolean;
  sortOrder: number;
}

/** One subscription, as the admin reads it. `teacherGranted` is the OTHER premium
 * source shown beside this one, because the two are independent and both are real. */
export interface AdminSubscriptionRow {
  id: string;
  userName: string;
  userEmail?: string | null;
  planName: string;
  status: string;
  startsAt: string;
  endsAt?: string | null;
  provider?: string | null;
  teacherGranted: boolean;
}

/** What a create/edit submits. Omitted fields are left alone by the server. */
export interface AdminPlanDraft {
  code: string;
  name: string;
  description: string;
  priceMinor: number;
  durationDays: number;
  active: boolean;
}

export interface AdminBillingProps {
  plans: AdminPlan[];
  subscriptions: AdminSubscriptionRow[];
  /** The `payments_enabled` flag, edited on the Sozlamalar screen and shown here
   * because this is where its consequences are. */
  paymentsEnabled: boolean;
  /** Whether a payment provider is actually wired up. FALSE while the adapter is a
   * stub — and when it is false the screen says so rather than implying tariffs can
   * be sold. */
  providerConfigured: boolean;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  onCreate?: (draft: AdminPlanDraft) => Promise<void>;
  onUpdate?: (id: string, draft: AdminPlanDraft) => Promise<void>;
  /** Refused by the server for a tariff anything was ever sold under — the rows that
   * say what a person bought must keep being able to say it. */
  onDelete?: (id: string) => Promise<void>;
}

/** A subscription's status as it stands NOW. */
export type EffectiveStatus = "active" | "pending" | "expired" | "cancelled" | "other";

/**
 * The status the badge shows — the row's `status` checked against its own dates,
 * the same rule the server's `PremiumAccess` applies before granting anything:
 * `active` AND started AND not yet ended.
 *
 * The stored status alone is not the truth. Nothing flips a row to `expired` at the
 * instant its window closes (a sweep job does, eventually), so a subscription that
 * ended last month can still read `active` — and a green "Premium" badge on it told
 * the admin that someone has premium the gate is already refusing them.
 */
export function effectiveStatus(
  row: Pick<AdminSubscriptionRow, "status" | "startsAt" | "endsAt">,
  now: number = Date.now(),
): EffectiveStatus {
  switch (row.status) {
    case "active": {
      const end = row.endsAt ? Date.parse(row.endsAt) : Number.NaN;
      if (!Number.isNaN(end) && end <= now) return "expired";
      const start = Date.parse(row.startsAt);
      if (!Number.isNaN(start) && start > now) return "pending";
      return "active";
    }
    case "pending":
    case "expired":
    case "cancelled":
      return row.status;
    default:
      // An unknown status is named as such, never printed raw.
      return "other";
  }
}

function statusBadge(status: EffectiveStatus, t: TFunction): { variant: BadgeVariant; label: string } {
  switch (status) {
    case "active":
      return { variant: "success", label: t("billing.status.active") };
    case "pending":
      return { variant: "neutral", label: t("billing.status.pending") };
    case "expired":
      return { variant: "neutral", label: t("billing.status.expired") };
    case "cancelled":
      return { variant: "neutral", label: t("billing.status.cancelled") };
    case "other":
      return { variant: "neutral", label: t("admin.billing.statusOther") };
  }
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * AdminBillingScreen — **Tariflar**: the tariff editor and a read-only view of who
 * currently holds a subscription.
 *
 * ## The banner is the most important thing on this page
 *
 * There is no merchant account yet, so no student can buy any of these. The screen
 * says that, at the top, in its own card — because an admin who fills in three
 * beautifully priced tariffs and hears nothing has every reason to assume they are
 * on sale. Preparing prices in advance is useful; being quietly wrong about whether
 * they are live is not.
 *
 * The two gates are reported separately (`paymentsEnabled` · `providerConfigured`)
 * because they have two different fixes: flip the switch on Sozlamalar, or wire an
 * adapter. Collapsing them into one "payments are off" would send the admin to the
 * wrong one half the time.
 *
 * ## Retire, don't delete
 *
 * A tariff with a subscription or payment attempt against it cannot be deleted — the
 * server refuses, and the row offers the **faollik** switch instead. That switch is
 * what "stop selling this price" actually means; a delete would leave a paid
 * subscription unable to say what was bought. The row's status reads **Faol /
 * Nofaol** — never "o'chirilgan", which sat beside the "O'chirish" button and read as
 * "already deleted". And the delete itself is a confirm, not one tap.
 */
export function AdminBillingScreen({
  plans,
  subscriptions,
  paymentsEnabled,
  providerConfigured,
  activeNavKey = "billing",
  onNavigate,
  onCreate,
  onUpdate,
  onDelete,
}: AdminBillingProps) {
  const { t } = useTranslation();
  // Ids, not snapshots — the same rule AdminPeopleScreen learned: holding the object
  // means an open sheet keeps showing the values from before the write that refetched
  // the list underneath it.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = useMemo(() => plans.find((p) => p.id === editingId) ?? null, [plans, editingId]);
  const deleting = useMemo(() => plans.find((p) => p.id === deletingId) ?? null, [plans, deletingId]);
  const sold = subscriptions.length;

  const closeSheet = () => {
    setEditingId(null);
    setCreating(false);
  };

  const submit = async (draft: AdminPlanDraft) => {
    setError(null);
    try {
      if (editing) await onUpdate?.(editing.id, draft);
      else await onCreate?.(draft);
      closeSheet();
    } catch {
      setError(t("admin.billing.saveFailed"));
    }
  };


  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: adminNavItems(t),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("admin.billing.title")}
        </Text>
      }
      headerEnd={
        <>
          <NotificationsBell />
          <AdminAccountButton />
        </>
      }
    >
      <div className={styles.page} data-density="compact">
        {/* ---- The honest state, first and unmissable ---- */}
        {!providerConfigured && (
          <Card variant="outline" padding="md" className={styles.notice} role="status">
            <Text as="p" variant="body" weight="semibold">
              {t("billing.notConnected.title")}
            </Text>
            <Text as="p" variant="body-s" color="muted">
              {t("admin.billing.notConnectedBody")}
            </Text>
            <div className={styles.gates}>
              <Badge variant={paymentsEnabled ? "success" : "neutral"} size="md">
                {t("admin.billing.flagState", {
                  state: paymentsEnabled ? t("admin.billing.on") : t("admin.billing.off"),
                })}
              </Badge>
              <Badge variant="neutral" size="md">
                {t("admin.billing.providerState", { state: t("admin.billing.notConnectedShort") })}
              </Badge>
            </div>
          </Card>
        )}

        {error && (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {error}
          </Text>
        )}

        {/* ---- Tariffs ---- */}
        <section className={styles.section} aria-label={t("admin.billing.plans")}>
          <div className={styles.sectionHead}>
            <Text as="h2" variant="label" color="muted" className={styles.legend}>
              {t("admin.billing.plans")}
            </Text>
            <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
              {t("admin.billing.newPlan")}
            </Button>
          </div>

          {plans.length === 0 ? (
            <Card variant="outline" padding="md">
              <Text as="p" variant="body" color="muted">
                {t("admin.billing.noPlans")}
              </Text>
            </Card>
          ) : (
            <ul className={styles.planList}>
              {plans.map((plan) => (
                <li key={plan.id}>
                  <Card variant="outline" padding="md" className={styles.planCard}>
                    <div className={styles.planHead}>
                      <span className={styles.planName}>
                        <Text as="h3" variant="title-s" truncate>
                          {plan.name}
                        </Text>
                        <Text as="span" variant="body-s" color="muted">
                          {plan.code}
                        </Text>
                      </span>
                      <Badge variant={plan.active ? "success" : "neutral"} size="md">
                        {plan.active ? t("admin.billing.planActive") : t("admin.billing.planInactive")}
                      </Badge>
                    </div>

                    <Text as="p" variant="title-m" numeric className={styles.price}>
                      {formatMinor(plan.priceMinor, plan.currency)}
                    </Text>
                    <Text as="p" variant="body-s" color="muted">
                      {t("admin.billing.duration", { days: plan.durationDays })}
                    </Text>
                    {plan.description && (
                      <Text as="p" variant="body-s" color="ink-soft">
                        {plan.description}
                      </Text>
                    )}

                    <div className={styles.planActions}>
                      <Button variant="ghost" size="sm" onClick={() => setEditingId(plan.id)}>
                        {t("admin.billing.edit")}
                      </Button>
                      {onDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setError(null);
                            setDeletingId(plan.id);
                          }}
                        >
                          {t("admin.billing.delete")}
                        </Button>
                      )}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Who holds a subscription ---- */}
        <section className={styles.section} aria-label={t("admin.billing.subscriptions")}>
          <div className={styles.sectionHead}>
            <Text as="h2" variant="label" color="muted" className={styles.legend}>
              {t("admin.billing.subscriptions")}
            </Text>
            <Badge variant="neutral" size="md">
              {sold}
            </Badge>
          </div>

          <Card variant="outline" padding="none">
            {subscriptions.length === 0 ? (
              <div className={styles.emptySubs}>
                <Text as="p" variant="body" color="muted">
                  {t("admin.billing.noSubscriptions")}
                </Text>
                <Text as="p" variant="body-s" color="muted">
                  {t("admin.billing.grantHint")}
                </Text>
              </div>
            ) : (
              <ul className={styles.subList}>
                {subscriptions.map((s) => {
                  const badge = statusBadge(effectiveStatus(s), t);
                  return (
                    <li key={s.id} className={styles.subRow}>
                      <span className={styles.subWho}>
                        <Text as="span" variant="body" weight="semibold" truncate>
                          {s.userName}
                        </Text>
                        <Text as="span" variant="body-s" color="muted" truncate>
                          {s.userEmail ?? s.planName}
                        </Text>
                      </span>
                      <span className={styles.subMeta}>
                        <Badge variant={badge.variant} size="md">
                          {badge.label}
                        </Badge>
                        {s.teacherGranted && (
                          <Badge variant="primary" size="md">
                            {t("admin.billing.alsoGranted")}
                          </Badge>
                        )}
                        <Text as="span" variant="body-s" color="muted" numeric>
                          {s.endsAt ? formatDay(s.endsAt) : "—"}
                        </Text>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </section>
      </div>

      <PlanSheet
        open={creating || editing !== null}
        plan={editing}
        onClose={closeSheet}
        onSubmit={submit}
      />

      {deleting && onDelete && (
        <DeletePlanDialog plan={deleting} onClose={() => setDeletingId(null)} onDelete={onDelete} />
      )}
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Delete confirmation                                                        */
/* -------------------------------------------------------------------------- */

/**
 * "O'chirish" used to fire on one tap. A tariff nothing was sold under is cheap to
 * lose, but not free — its price and wording were somebody's decision — and a button
 * that deletes on contact sits one row away from "Tahrirlash". So: a confirm that
 * names the tariff, and, when the server refuses (it was sold under), the reason in
 * the dialog itself, with the way out (deactivate it) in the same sentence.
 */
function DeletePlanDialog({
  plan,
  onClose,
  onDelete,
}: {
  plan: AdminPlan;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(plan.id);
      onClose();
    } catch (e) {
      setError(
        isNetworkError(e)
          ? t("auth.errors.network")
          : isApiError(e) && e.status === 409
            ? t("admin.billing.deleteRefused")
            : t("admin.billing.deleteFailed"),
      );
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t("admin.billing.deleteTitle")} closeLabel={t("common.close")}>
      <div className={styles.form}>
        <Card variant="outline" padding="md">
          <Text as="p" variant="body" weight="semibold">
            {plan.name}
          </Text>
          <Text as="p" variant="body-s" color="muted">
            {plan.code} · {formatMinor(plan.priceMinor, plan.currency)}
          </Text>
        </Card>
        <Text as="p" variant="body">
          {t("admin.billing.deleteBody")}
        </Text>
        {error && (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {error}
          </Text>
        )}
        <div className={styles.formActions}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>
            {t("admin.billing.deleteConfirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Create / edit sheet                                                        */
/* -------------------------------------------------------------------------- */

interface PlanSheetProps {
  open: boolean;
  plan: AdminPlan | null;
  onClose: () => void;
  onSubmit: (draft: AdminPlanDraft) => Promise<void>;
}

/**
 * The price is typed in SO'M and converted to tiyin on submit — an admin should not
 * have to know the wire unit, and asking them to type 4990000 is how a price ends up
 * a hundred times wrong. The field refuses anything that is not a plain amount rather
 * than sending a NaN the server would have to guess at.
 */
function PlanSheet({ open, plan, onClose, onSubmit }: PlanSheetProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [days, setDays] = useState("30");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);

  // Re-seed whenever the sheet opens on a different plan (or on "new"), so it never
  // shows the previous subject's values for a moment.
  useEffect(() => {
    if (!open) return;
    setCode(plan?.code ?? "");
    setName(plan?.name ?? "");
    setDescription(plan?.description ?? "");
    setPrice(plan ? String(Math.floor(plan.priceMinor / 100)) : "");
    setDays(String(plan?.durationDays ?? 30));
    setActive(plan?.active ?? true);
    setInvalid(null);
  }, [open, plan]);

  const save = async () => {
    if (busy) return;
    const priceMinor = parseMajorToMinor(price);
    const durationDays = Number(days);
    if (priceMinor === null) {
      setInvalid(t("admin.billing.badPrice"));
      return;
    }
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 366) {
      setInvalid(t("admin.billing.badDuration"));
      return;
    }
    if (code.trim().length === 0 || name.trim().length === 0) {
      setInvalid(t("admin.billing.badName"));
      return;
    }

    setBusy(true);
    setInvalid(null);
    try {
      await onSubmit({
        code: code.trim(),
        name: name.trim(),
        description: description.trim(),
        priceMinor,
        durationDays,
        active,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={plan ? t("admin.billing.editPlan") : t("admin.billing.newPlan")}
    >
      <div className={styles.form}>
        <Input
          label={t("admin.billing.name")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="1 oylik Premium"
        />
        <Input
          label={t("admin.billing.code")}
          value={code}
          onChange={(e) => setCode(e.currentTarget.value)}
          placeholder="monthly"
          hint={t("admin.billing.codeHint")}
        />
        <Input
          label={t("admin.billing.price")}
          value={price}
          inputMode="numeric"
          onChange={(e) => setPrice(e.currentTarget.value)}
          placeholder="49900"
          hint={t("admin.billing.priceHint")}
        />
        <Input
          label={t("admin.billing.durationDays")}
          type="number"
          min={1}
          max={366}
          value={days}
          onChange={(e) => setDays(e.currentTarget.value)}
        />
        <Input
          label={t("admin.billing.description")}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        <div className={styles.switchRow}>
          <span className={styles.switchText}>
            <Text as="span" variant="body" weight="semibold">
              {t("admin.billing.activeLabel")}
            </Text>
            <Text as="span" variant="body-s" color="muted">
              {t("admin.billing.activeHint")}
            </Text>
          </span>
          <Switch checked={active} onChange={setActive} aria-label={t("admin.billing.activeLabel")} />
        </div>

        {invalid && (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {invalid}
          </Text>
        )}

        <div className={styles.formActions}>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** `21.10.2026` — the shared fixed-width numeric date (scans well under
 * `tabular-nums`), on the product's Tashkent day. */
function formatDay(iso: string): string {
  return formatDate(iso, { zone: "tashkent" }) || iso.slice(0, 10);
}

/** Demo host for the screen gallery — mock data, no network. */
export default function AdminBillingDemo() {
  return (
    <AdminBillingScreen
      plans={mockAdminPlans}
      subscriptions={mockAdminSubscriptions}
      paymentsEnabled={false}
      providerConfigured={false}
    />
  );
}
