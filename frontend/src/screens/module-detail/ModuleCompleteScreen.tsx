/**
 * ModuleCompleteScreen (D3) — the module "done" celebration (mockup frame D3).
 *
 * Rendered by the page in place of D2 when every task in the module is finished.
 * A proud Govo, "Modul yakunlandi! 🎉" + the module name, three stat cells
 * ({done}/{total} · average band · time from `spent_sec`), a decorative
 * certificate card, then "KEYINGI MODUL" with the next not-done module (which may
 * be locked) and a "Keyingi modul →" primary. When there is no next module the
 * next block collapses to the `allDone` state.
 *
 * Presentational + prop-driven: the page computes the average from the module's
 * task bands and passes the raw `spentSec`; this screen only formats and lays out.
 * Every colour / space / radius value is a token; full-width; copy via `mashq.*`.
 */
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button, Card, Mascot, StatTile, Text } from "../../shared/ui";
import { Page } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockModuleComplete } from "./module-detail.mock";
import styles from "./ModuleCompleteScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** The card teasing the module the student should tackle next. */
export interface NextModuleInfo {
  id: string;
  name: string;
  level: string | null;
  taskCount: number;
  /** True when that module is still gated (Pro / sequential). */
  locked: boolean;
}

export interface ModuleCompleteScreenProps {
  /** The finished module's name. */
  name: string;
  done: number;
  total: number;
  /** Average of the module's task bands (0..100); null when none are graded. */
  averageBand: number | null;
  /** Total seconds spent across the module's tasks (feeds the "vaqt" cell). */
  spentSec: number;
  /** The next not-done module, or null when everything is finished. */
  next: NextModuleInfo | null;
  /** Advance to the next module. */
  onNextModule: (id: string) => void;
  /**
   * The certificate download. The WHOLE certificate card renders only when this is
   * given: there is no certificate behind it today, and "Sertifikat tayyor" on a
   * card with nothing to download promised a document that does not exist.
   */
  onDownloadCert?: () => void;
  /** The header back affordance → back to the Mashq hub. */
  onBack: () => void;
  /** Active nav key (defaults to "practice"). */
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export function ModuleCompleteScreen({
  name,
  done,
  total,
  averageBand,
  spentSec,
  next,
  onNextModule,
  onDownloadCert,
  onBack,
}: ModuleCompleteScreenProps) {
  const { t } = useTranslation();

  return (
    <Page headerStart={<BackButton onBack={onBack} label={t("common.back")} />}>
      <div className={styles.page}>
        {/* ---- Celebration ---- */}
        <header className={styles.hero}>
          <Mascot mood="proud" size={104} label="Govo" />
          <Text as="h1" variant="title-l" align="center" className={styles.title}>
            {t("mashq.complete.title")} <span aria-hidden>🎉</span>
          </Text>
          <Text as="p" variant="body-l" color="muted" align="center">
            {name}
          </Text>
        </header>

        {/* ---- Stat cells ---- */}
        <div className={styles.statGrid}>
          <StatTile
            variant="outline"
            value={`${done}/${total}`}
            label={t("mashq.complete.tasks")}
          />
          <StatTile
            variant="outline"
            value={averageBand === null ? EM_DASH : Math.round(averageBand)}
            label={t("mashq.complete.average")}
          />
          <StatTile
            variant="outline"
            value={formatSpent(t, spentSec)}
            label={t("mashq.complete.time")}
          />
        </div>

        {/* ---- Certificate — only when there is one to download ---- */}
        {onDownloadCert && (
          <Card variant="tint" padding="lg" className={styles.certCard}>
            <span className={styles.certIcon} aria-hidden>
              🏅
            </span>
            <span className={styles.certBody}>
              <Text as="p" variant="title-s">
                {t("mashq.complete.certTitle")}
              </Text>
              <Text as="p" variant="body-s" color="muted">
                {t("mashq.complete.certBody")}
              </Text>
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={onDownloadCert}
              aria-label={t("mashq.complete.certBody")}
              className={styles.certBtn}
            >
              <DownloadIcon />
            </Button>
          </Card>
        )}

        {/* ---- Next module ---- */}
        {next ? (
          <section className={styles.nextSection} aria-label={t("mashq.complete.nextLabel")}>
            <Text as="h2" variant="label" color="muted" className={styles.nextLabel}>
              {t("mashq.complete.nextLabel")}
            </Text>

            <Card variant="outline" padding="md" className={styles.nextCard}>
              <span className={styles.nextInfo}>
                <Text as="p" variant="title-s" truncate>
                  {next.name}
                </Text>
                <Text as="p" variant="body-s" color="muted" numeric>
                  {t("mashq.complete.nextMeta", {
                    level: next.level ?? EM_DASH,
                    count: next.taskCount,
                  })}
                </Text>
              </span>
              {next.locked && (
                <span className={styles.nextLock} aria-hidden>
                  <LockIcon />
                </span>
              )}
            </Card>

            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => onNextModule(next.id)}
              className={styles.nextCta}
            >
              {t("mashq.complete.nextCta")} <span aria-hidden>→</span>
            </Button>
          </section>
        ) : (
          <Text as="p" variant="body-l" color="muted" align="center" className={styles.allDone}>
            {t("mashq.complete.allDone")}
          </Text>
        )}
      </div>
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Placeholder for "no value" — typography, not translatable copy. */
const EM_DASH = "—";

/** Format the module's total practice time: "{{h}}s {{m}}'" from an hour up,
 * "{{m}}'" below. `spentSec` is whole seconds; only whole minutes are shown. */
function formatSpent(t: TFunction, spentSec: number): string {
  const totalMin = Math.max(0, Math.floor(spentSec / 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h >= 1
    ? t("mashq.complete.timeValue", { h, m })
    : t("mashq.complete.timeMinutes", { m: totalMin });
}

/* -------------------------------------------------------------------------- */
/* Header back button + glyphs                                                */
/* -------------------------------------------------------------------------- */

function BackButton({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onBack} aria-label={label} className={styles.back}>
      <ArrowLeftIcon />
    </Button>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M15 5l-7 7 7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M7 10V8a5 5 0 0110 0v2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect x="5" y="10" width="14" height="10" rx="2.5" fill="currentColor" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

export default function ModuleCompleteScreenDemo() {
  return (
    <ModuleCompleteScreen
      {...mockModuleComplete}
      onNextModule={() => undefined}
      onBack={() => undefined}
      onNavigate={() => undefined}
    />
  );
}
