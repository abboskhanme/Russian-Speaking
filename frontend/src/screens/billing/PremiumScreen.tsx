/**
 * PremiumScreen — «Premium», the student's subscription place (docs/08 Faza 6.6).
 *
 * Reached from the profile's PRO card and from the paywall a 402 raises. It answers three
 * questions in this order: do I have premium right now, what would it cost, and can I buy it.
 *
 * ## The refusal is a first-class state, not an error
 *
 * There is no merchant account yet. The provider adapter is a stub that cannot take money, so the
 * purchase button does not exist and the screen says, plainly, that payments are not connected yet.
 * That is the whole point of this screen shipping before the integration does: a student who taps
 * "Sotib olish" and is told their subscription is active — when nothing was charged and nothing was
 * granted — has been lied to, and would discover it the next time the paywall stopped them. Prices
 * may be shown; a purchase may not be implied.
 *
 * ## Premium has two sources and they are named
 *
 * `source: "teacher"` means a teacher granted it — it does not lapse and there is nothing to buy.
 * `source: "subscription"` means it was paid for and has an end date. Showing "Premium" without
 * saying which would leave a granted student wondering when their access expires, and a paying one
 * unable to see when to renew.
 *
 * Presentational + prop-driven: it fetches nothing and owns no server state. Full-width per
 * docs/04 §4.10; every colour / space / radius value is a token.
 */
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Text } from "../../shared/ui";
import { formatMinor } from "../../shared/money";
import { Page } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockPremiumPlans, mockPremiumStatus } from "./billing.mock";
import styles from "./PremiumScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** One tariff on offer. `priceMinor` is TIYIN — see `shared/money`. */
export interface PremiumPlan {
  id: string;
  name: string;
  description?: string | null;
  priceMinor: number;
  currency: string;
  durationDays: number;
}

/** Where the caller's premium comes from, resolved server-side from the SAME rule the 402 gate
 * uses. `"teacher"` — granted; `"subscription"` — paid; `"none"` — neither. */
export type PremiumSource = "teacher" | "subscription" | "none";

export interface PremiumStatus {
  isPremium: boolean;
  source: PremiumSource;
  /** The subscription row's status, or `"none"` when there has never been one. A lapsed one still
   * reports here, so the screen can say when it ended instead of pretending it never existed. */
  status: string;
  planName?: string | null;
  endsAt?: string | null;
  /** The `payments_enabled` flag. OFF by default. */
  paymentsEnabled: boolean;
  /** Whether a provider is actually wired up. FALSE while the adapter is a stub. */
  providerConfigured: boolean;
}

export interface PremiumScreenProps {
  status: PremiumStatus;
  plans: PremiumPlan[];
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  /**
   * Start a purchase. Rendered ONLY when both gates are open — the flag is on AND a provider is
   * configured. Passing it while they are shut does not put a button on screen: the screen decides
   * from `status`, so a host cannot accidentally offer a purchase that cannot complete.
   */
  onBuy?: (planId: string) => Promise<void>;
  /** Where "Yordam" goes — the support link from `GET /api/settings/links`. */
  supportUrl?: string | null;
  /**
   * What the last purchase attempt answered. Rendered beside the prices rather than as a toast:
   * a toast that has faded leaves someone staring at an unchanged screen wondering whether
   * anything happened, and "nothing was charged" is a fact that must stay on screen.
   */
  notice?: { tone: "info" | "danger"; message: string } | null;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export function PremiumScreen({
  status,
  plans,
  onBuy,
  supportUrl,
  notice,
}: PremiumScreenProps) {
  const { t } = useTranslation();

  // BOTH gates, and the screen — not the host — decides. A purchase is offered only when the
  // server says it can actually happen.
  const canBuy = status.paymentsEnabled && status.providerConfigured;

  return (
    <Page title={t("billing.title")}>
      <div className={styles.page}>
        <StatusCard status={status} />

        {/* The honest refusal. Above the prices, not below them, so nobody reads a price
            list and only afterwards learns none of it is purchasable. */}
        {!canBuy && !status.isPremium && (
          <Card variant="outline" padding="lg" className={styles.notice} role="status">
            <Text as="h2" variant="title-s">
              {t("billing.notConnected.title")}
            </Text>
            <Text as="p" variant="body" color="ink-soft">
              {t("billing.notConnected.body")}
            </Text>
            <Text as="p" variant="body-s" color="muted">
              {t("billing.notConnected.meanwhile")}
            </Text>
            {supportUrl && (
              <a className={styles.supportLink} href={supportUrl} target="_blank" rel="noreferrer">
                {t("billing.notConnected.contact")}
              </a>
            )}
          </Card>
        )}

        {notice && (
          <Text
            as="p"
            variant="body-s"
            color={notice.tone === "danger" ? "danger" : "info"}
            role="status"
          >
            {notice.message}
          </Text>
        )}

        {plans.length > 0 && (
          <section className={styles.section} aria-label={t("billing.plans")}>
            <Text as="h2" variant="label" color="muted" className={styles.legend}>
              {t("billing.plans")}
            </Text>
            <ul className={styles.planList}>
              {plans.map((plan) => (
                <li key={plan.id}>
                  <Card variant="outline" padding="lg" className={styles.planCard}>
                    <Text as="h3" variant="title-s">
                      {plan.name}
                    </Text>
                    <Text as="p" variant="display" numeric className={styles.price}>
                      {formatMinor(plan.priceMinor, plan.currency)}
                    </Text>
                    <Text as="p" variant="body-s" color="muted">
                      {t("billing.perDays", { days: plan.durationDays })}
                    </Text>
                    {plan.description && (
                      <Text as="p" variant="body" color="ink-soft">
                        {plan.description}
                      </Text>
                    )}
                    {canBuy ? (
                      <Button
                        variant="primary"
                        fullWidth
                        className={styles.buy}
                        onClick={() => void onBuy?.(plan.id)}
                      >
                        {t("billing.buy")}
                      </Button>
                    ) : (
                      // Not a disabled button. A greyed-out "Sotib olish" reads as "try again
                      // later, maybe it will work" and invites tapping at it; a plain line of text
                      // says the thing that is true.
                      <Text as="p" variant="body-s" color="muted" className={styles.unavailable}>
                        {t("billing.notConnected.short")}
                      </Text>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={styles.section} aria-label={t("billing.included")}>
          <Text as="h2" variant="label" color="muted" className={styles.legend}>
            {t("billing.included")}
          </Text>
          <Card variant="flat" padding="lg">
            <ul className={styles.perks}>
              <li>
                <Text as="span" variant="body">
                  {t("billing.perk.allTasks")}
                </Text>
              </li>
              <li>
                <Text as="span" variant="body">
                  {t("billing.perk.allModules")}
                </Text>
              </li>
              <li>
                <Text as="span" variant="body">
                  {t("billing.perk.feedback")}
                </Text>
              </li>
            </ul>
          </Card>
        </section>
      </div>
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

function StatusCard({ status }: { status: PremiumStatus }) {
  const { t } = useTranslation();

  if (!status.isPremium) {
    return (
      <Card variant="flat" padding="lg" className={styles.statusCard}>
        <Badge variant="neutral" size="md">
          {t("billing.status.free")}
        </Badge>
        <Text as="p" variant="title-m">
          {t("billing.free.title")}
        </Text>
        <Text as="p" variant="body" color="ink-soft">
          {t("billing.free.body")}
        </Text>
        {/* A subscription that has lapsed is still worth naming — "you had one and it ended"
            is a different situation from "you have never had one", and only one of them
            explains why the paywall appeared today. */}
        {status.status === "expired" && status.endsAt && (
          <Text as="p" variant="body-s" color="muted" numeric>
            {t("billing.expiredOn", { date: status.endsAt.slice(0, 10) })}
          </Text>
        )}
      </Card>
    );
  }

  return (
    <Card variant="tint" padding="lg" className={styles.statusCard}>
      <Badge variant="success" size="md">
        {t("billing.status.active")}
      </Badge>
      <Text as="p" variant="title-m">
        {status.source === "teacher" ? t("billing.byTeacher.title") : t("billing.paid.title")}
      </Text>
      <Text as="p" variant="body" color="ink-soft">
        {status.source === "teacher" ? t("billing.byTeacher.body") : t("billing.paid.body")}
      </Text>
      {status.source === "subscription" && (
        <dl className={styles.meta}>
          {status.planName && (
            <div className={styles.metaRow}>
              <dt>
                <Text as="span" variant="body-s" color="muted">
                  {t("billing.planLabel")}
                </Text>
              </dt>
              <dd>
                <Text as="span" variant="body" weight="semibold">
                  {status.planName}
                </Text>
              </dd>
            </div>
          )}
          {status.endsAt && (
            <div className={styles.metaRow}>
              <dt>
                <Text as="span" variant="body-s" color="muted">
                  {t("billing.endsLabel")}
                </Text>
              </dt>
              <dd>
                <Text as="span" variant="body" weight="semibold" numeric>
                  {status.endsAt.slice(0, 10)}
                </Text>
              </dd>
            </div>
          )}
        </dl>
      )}
    </Card>
  );
}

/** Demo host for the screen gallery — mock data, no network. */
export default function PremiumDemo() {
  return <PremiumScreen status={mockPremiumStatus} plans={mockPremiumPlans} />;
}
