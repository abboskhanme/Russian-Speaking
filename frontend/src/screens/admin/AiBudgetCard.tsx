import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Input, Switch, Text } from "../../shared/ui";
import type { BadgeVariant } from "../../shared/ui";
import { isNetworkError } from "./adminErrors";
import styles from "./AdminSettingsScreen.module.css";

/** One backend × operation's share of this month's estimated AI spend. */
export interface AdminAiSpendLine {
  provider: string;
  /** `stt` | `grader` */
  operation: string;
  calls: number;
  failedCalls: number;
  costUsd: number;
}

/** The global AI ceiling as `GET /api/admin/settings/ai-budget` describes it. */
export interface AdminAiBudget {
  paused: boolean;
  dailyCapUsd: number;
  monthlyCapUsd: number;
  spentTodayUsd: number;
  spentMonthUsd: number;
  /** `open` | `paused` | `daily_cap` | `monthly_cap` */
  state: string;
  /** The product day (Tashkent) the figures are for, `YYYY-MM-DD`. */
  day: string;
  month: AdminAiSpendLine[];
}

/** Tri-state strings, like every other settings write: absent = unchanged. */
export interface AdminAiBudgetPatch {
  aiPaused?: string;
  dailyCapUsd?: string;
  monthlyCapUsd?: string;
}

const STATE_BADGE: Record<string, BadgeVariant> = {
  open: "success",
  paused: "danger",
  daily_cap: "warn",
  monthly_cap: "danger",
};

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * AiBudgetCard — the platform-wide AI spend ceiling and its kill switch.
 *
 * Every per-student limit (freemium, attempts, the roleplay and drill allowances)
 * bounds one account. This card is the one place that bounds the SUM: a daily and a
 * monthly cap on the estimated vendor spend, and a switch that stops every new AI
 * call at once. At the cap — or paused — students are told "try again later" by the
 * same screens that already say it when no AI key is configured; recordings are kept.
 *
 * The figures are ESTIMATES from configured unit prices (see docs/ASSUMPTIONS.md), not
 * a vendor invoice — the card says so, because a number presented as a bill gets
 * reconciled against one.
 */
export function AiBudgetCard({
  budget,
  onSave,
}: {
  budget: AdminAiBudget;
  onSave?: (patch: AdminAiBudgetPatch) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [paused, setPaused] = useState(budget.paused);
  const [daily, setDaily] = useState(String(budget.dailyCapUsd));
  const [monthly, setMonthly] = useState(String(budget.monthlyCapUsd));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  // Re-seed from the server after a save: the stored, normalised values are the truth.
  useEffect(() => {
    setPaused(budget.paused);
    setDaily(String(budget.dailyCapUsd));
    setMonthly(String(budget.monthlyCapUsd));
  }, [budget.paused, budget.dailyCapUsd, budget.monthlyCapUsd]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      // Only what changed, so saving the switch never rewrites a cap someone else set.
      const patch: AdminAiBudgetPatch = {};
      if (paused !== budget.paused) patch.aiPaused = String(paused);
      if (daily.trim() !== String(budget.dailyCapUsd)) patch.dailyCapUsd = daily.trim();
      if (monthly.trim() !== String(budget.monthlyCapUsd)) patch.monthlyCapUsd = monthly.trim();
      await onSave?.(patch);
      setResult({ tone: "success", text: t("admin.saved") });
    } catch (e) {
      setResult({
        tone: "danger",
        text: isNetworkError(e) ? t("auth.errors.network") : t("admin.aiBudgetInvalid"),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section} aria-label={t("admin.aiBudget")}>
      <div className={styles.sectionHead}>
        <Text as="h2" variant="label" color="muted" className={styles.legend}>
          {t("admin.aiBudget")}
        </Text>
        <Badge variant={STATE_BADGE[budget.state] ?? "neutral"} size="sm">
          {t(`admin.aiBudgetState.${budget.state}`, { defaultValue: budget.state })}
        </Badge>
      </div>
      <Card variant="outline" padding="md" className={styles.card}>
        <div className={styles.switchRow}>
          <span className={styles.switchText}>
            <Text as="span" variant="body" weight="semibold">
              {t("admin.aiPaused")}
            </Text>
            <Text as="span" variant="body-s" color="muted">
              {t("admin.aiPausedHint")}
            </Text>
          </span>
          <Switch checked={paused} onChange={setPaused} aria-label={t("admin.aiPaused")} />
        </div>

        <Meter
          label={t("admin.aiSpentToday", { day: budget.day })}
          spent={budget.spentTodayUsd}
          cap={budget.dailyCapUsd}
        />
        <Meter label={t("admin.aiSpentMonth")} spent={budget.spentMonthUsd} cap={budget.monthlyCapUsd} />

        <Input
          label={t("admin.aiDailyCap")}
          type="number"
          min={0.01}
          step={0.01}
          value={daily}
          onChange={(e) => setDaily(e.currentTarget.value)}
        />
        <Input
          label={t("admin.aiMonthlyCap")}
          type="number"
          min={0.01}
          step={0.01}
          value={monthly}
          onChange={(e) => setMonthly(e.currentTarget.value)}
        />

        {budget.month.length > 0 && (
          <ul className={styles.spendList} aria-label={t("admin.aiSpendBreakdown")}>
            {budget.month.map((line) => (
              <li key={`${line.provider}:${line.operation}`} className={styles.spendLine}>
                <Text as="span" variant="body-s">
                  {line.provider} · {t(`admin.aiOperation.${line.operation}`, { defaultValue: line.operation })}
                </Text>
                <Text as="span" variant="body-s" color="muted">
                  {t("admin.aiCalls", { calls: line.calls, failed: line.failedCalls })}
                </Text>
                <Text as="span" variant="body-s" weight="semibold">
                  {usd(line.costUsd)}
                </Text>
              </li>
            ))}
          </ul>
        )}

        <Text as="p" variant="body-s" color="muted">
          {t("admin.aiBudgetHint")}
        </Text>
        <div className={styles.actions}>
          {result && (
            <Text
              as="span"
              variant="body-s"
              color={result.tone}
              role={result.tone === "danger" ? "alert" : "status"}
              className={styles.saveResult}
            >
              {result.text}
            </Text>
          )}
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void save()}>
            {t("admin.saveAiBudget")}
          </Button>
        </div>
      </Card>
    </section>
  );
}

/** "$1.20 / $10.00" with a bar; amber from 80%, red at the cap — the same 80% the
 * server logs a warning at. */
function Meter({ label, spent, cap }: { label: string; spent: number; cap: number }) {
  const ratio = cap > 0 ? spent / cap : 1;
  const tone = ratio >= 1 ? "danger" : ratio >= 0.8 ? "warn" : "ok";
  return (
    <div className={styles.field}>
      <div className={styles.switchRow}>
        <Text as="span" variant="body-s">
          {label}
        </Text>
        <Text as="span" variant="body-s" weight="semibold">
          {usd(spent)} / {usd(cap)}
        </Text>
      </div>
      <div
        className={styles.meter}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={Math.min(spent, cap)}
        data-tone={tone}
      >
        <span className={styles.meterFill} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </div>
  );
}
