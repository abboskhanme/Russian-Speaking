/**
 * ModuleDetailScreen (D2) — the inside of one practice module (mockup frame D2).
 *
 * An AppShell frame with a back button in the header, a hero that stacks the
 * "MODUL" label, an inline-SVG circular progress ring (% done), the module name
 * and the "{done}/{total} vazifa" count, then the "TOPSHIRIQLAR" list. Each task
 * row renders by state: DONE (green check chip + its band on the right), CURRENT
 * — the task whose id matched `next_task_id` — (orange play chip + a "Boshlash"
 * button) and LOCKED (lock chip + "Yopiq", muted).
 *
 * Presentational + prop-driven: it fetches nothing and owns no server state; the
 * page maps the wire module into these clean props and wires the callbacks. Every
 * colour / space / radius / motion value is a token; layout is full-width; all
 * copy comes from i18n under `mashq.*`.
 */
import { useTranslation } from "react-i18next";
import { Button, Card, Text, cx } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, studentNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockModuleDetail } from "./module-detail.mock";
import styles from "./ModuleDetailScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** How a task reads in the list: finished, the one to do now, or still locked. */
export type ModuleTaskState = "done" | "current" | "locked";

export interface ModuleDetailTask {
  id: string;
  /** 1-based position within the module — the "N-vazifa" number. */
  index: number;
  title: string;
  state: ModuleTaskState;
  /** Best overall band (0..100) for a done task; null otherwise. */
  band: number | null;
}

export interface ModuleDetailScreenProps {
  /** Module name — the hero title under the ring. */
  name: string;
  /** Total tasks in the module (ring denominator). */
  total: number;
  /** Finished tasks (ring numerator). */
  doneCount: number;
  /** The tasks in display order, already tagged with their state. */
  tasks: ModuleDetailTask[];
  /** "Boshlash" on the current task → open the recording screen for it. */
  onStartTask: (taskId: string) => void;
  /** The header back affordance → back to the Mashq hub. */
  onBack: () => void;
  /** Active nav key (defaults to "practice"). */
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export function ModuleDetailScreen({
  name,
  total,
  doneCount,
  tasks,
  onStartTask,
  onBack,
  activeNavKey = "practice",
  onNavigate,
}: ModuleDetailScreenProps) {
  const { t } = useTranslation();
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: studentNavItems(t),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={<BackButton onBack={onBack} label={t("common.back")} />}
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page}>
        {/* ---- Hero: label · ring · name · count ---- */}
        <header className={styles.hero}>
          <Text as="p" variant="label" color="muted" className={styles.moduleLabel}>
            {t("mashq.detail.label")}
          </Text>

          <ProgressRing pct={pct} />

          <Text as="h1" variant="title-l" align="center" className={styles.name}>
            {name}
          </Text>
          <Text as="p" variant="body-s" color="muted" numeric>
            {t("mashq.detail.taskCount", { done: doneCount, total })}
          </Text>
        </header>

        {/* ---- Tasks ---- */}
        <section className={styles.tasksSection} aria-label={t("mashq.detail.tasksLabel")}>
          <Text as="h2" variant="label" color="muted" className={styles.tasksLabel}>
            {t("mashq.detail.tasksLabel")}
          </Text>

          <Card variant="outline" padding="none" className={styles.tasksCard}>
            <ul className={styles.taskList}>
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} onStart={onStartTask} />
              ))}
            </ul>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Task row                                                                   */
/* -------------------------------------------------------------------------- */

function TaskRow({
  task,
  onStart,
}: {
  task: ModuleDetailTask;
  onStart: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const { id, index, title, state, band } = task;

  return (
    <li className={cx(styles.taskRow, state === "locked" && styles.taskRowMuted)}>
      <StateChip state={state} />

      <span className={styles.taskText}>
        <Text
          as="span"
          variant="body-s"
          weight="semibold"
          color={state === "current" ? "warn" : "muted"}
          className={styles.taskMeta}
        >
          {state === "current"
            ? t("mashq.detail.taskCurrent", { n: index })
            : t("mashq.detail.taskN", { n: index })}
        </Text>
        <Text as="span" variant="title-s" truncate className={styles.taskTitle}>
          {title}
        </Text>
      </span>

      <span className={styles.taskEnd}>
        {state === "done" && band !== null && (
          <Text as="span" variant="title-s" numeric color="success" className={styles.bandScore}>
            {band}
          </Text>
        )}
        {state === "current" && (
          <Button variant="primary" size="sm" onClick={() => onStart(id)}>
            {t("mashq.detail.start")}
          </Button>
        )}
        {state === "locked" && (
          <Text as="span" variant="body-s" color="muted">
            {t("mashq.detail.locked")}
          </Text>
        )}
      </span>
    </li>
  );
}

/** The leading state chip: green check (done) · orange play (current) · lock. */
function StateChip({ state }: { state: ModuleTaskState }) {
  return (
    <span className={cx(styles.chip, styles[`chip_${state}`])} aria-hidden>
      {state === "done" && <CheckIcon />}
      {state === "current" && <PlayIcon />}
      {state === "locked" && <LockIcon />}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Progress ring — inline SVG, tokens only                                    */
/* -------------------------------------------------------------------------- */

const RING_R = 52;
const RING_CIRC = 2 * Math.PI * RING_R;

/** A circular progress ring sweeping `pct`% in `--info`, the number in its
 * centre. Decorative (`aria-hidden`) — the "{done}/{total} vazifa" caption below
 * carries the same meaning in words. The sweep animates via `stroke-dashoffset`,
 * zeroed under `prefers-reduced-motion` through the `--m-slow` token. */
function ProgressRing({ pct }: { pct: number }) {
  const frac = Math.max(0, Math.min(1, pct / 100));
  return (
    <div className={styles.ring} aria-hidden>
      <svg width="132" height="132" viewBox="0 0 120 120" className={styles.ringSvg}>
        <circle cx="60" cy="60" r={RING_R} fill="none" stroke="var(--surface-3)" strokeWidth="11" />
        <circle
          cx="60"
          cy="60"
          r={RING_R}
          fill="none"
          stroke="var(--info)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={RING_CIRC}
          strokeDashoffset={RING_CIRC * (1 - frac)}
          className={styles.ringProgress}
        />
      </svg>
      <span className={styles.ringCenter}>
        <Text as="span" variant="display" weight="black" numeric className={styles.ringPct}>
          {pct}
        </Text>
        <span className={styles.ringSign}>%</span>
      </span>
    </div>
  );
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

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 12.5l4.5 4.5L19 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
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

export default function ModuleDetailScreenDemo() {
  return (
    <ModuleDetailScreen
      {...mockModuleDetail}
      onStartTask={() => undefined}
      onBack={() => undefined}
      onNavigate={() => undefined}
    />
  );
}
