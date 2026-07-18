import { Badge, Button, Card, Mascot, Text, cx } from "../../shared/ui";
import type { MascotMood } from "../../shared/ui";
import { AppShell, Brand, ThemeToggle, studentNavItems } from "../../widgets";
import type { NavItem, ThemeMode } from "../../widgets";
import {
  mockContinue,
  mockDailyGoal,
  mockModules,
  mockStreak,
  mockUser,
} from "./home.mock";
import styles from "./HomeScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

export interface HomeUser {
  /** The student's display name (first name is enough — the greeting is warm). */
  name: string;
  /**
   * Localized, time-of-day greeting line shown above the name
   * (e.g. "Xayrli tong,"). The caller localizes; the screen just renders it.
   */
  greeting: string;
  /** Current CEFR level badge (e.g. "A2"). Hidden when omitted. */
  level?: string;
}

export interface HomeDailyGoal {
  /** Units done today (minutes / steps). */
  done: number;
  /** Today's target in the same unit. */
  target: number;
  /** Unit label for the caption + a11y text (default "daqiqa"). */
  unit?: string;
}

export interface HomeStreak {
  /** Current streak length, in days. */
  current: number;
  /** Streak-freeze protections banked (Duolingo-style "muzlatish"). */
  freezes: number;
  /**
   * Whether today's goal is already met — the flame is "lit" (primary) vs.
   * "at risk" (muted). Purely visual; defaults to false.
   */
  todayComplete?: boolean;
}

export interface HomeContinueSteps {
  /** Total steps in the resumable session (e.g. 3: isinish · gapirish · tuzatish). */
  total: number;
  /** Steps already completed. */
  done: number;
}

export interface HomeContinueTarget {
  /** Small uppercase kicker above the title (e.g. "Bugungi mashq"). */
  kicker?: string;
  /** The prominent title — a session name or the module being resumed. */
  title: string;
  /** One short line describing what "Continue" resumes. */
  subtitle?: string;
  /** Optional CEFR / band badge on the card. */
  band?: string;
  /** Multi-step session preview (filled = done). Distinct from the daily goal. */
  steps?: HomeContinueSteps;
  /** Govo's mood on the card (default "idle"). */
  mood?: MascotMood;
  /** CTA label (default "Boshlash →"). */
  actionLabel?: string;
}

export type ModuleStatus = "not-started" | "in-progress" | "done" | "locked";

export interface HomeModule {
  id: string;
  name: string;
  /** CEFR band (e.g. "A2"). */
  level?: string;
  /** Task-count caption (e.g. "12 vazifa"). */
  count?: string;
  /** Completion, 0..100. */
  progress: number;
  status: ModuleStatus;
  /** Teacher-assigned module — gets the accent "O'qituvchi" badge. */
  teacher?: boolean;
}

export interface HomeScreenProps {
  user: HomeUser;
  dailyGoal: HomeDailyGoal;
  streak: HomeStreak;
  continueTarget: HomeContinueTarget;
  modules: HomeModule[];
  /** Govo's mood in the greeting header (default "idle"). */
  mood?: MascotMood;
  /** Resume the daily session / continue target (the prominent CTA). */
  onContinue?: () => void;
  /** Open a module from the list (never fired for locked modules). */
  onOpenModule?: (id: string, module: HomeModule) => void;
  /** Active nav key (defaults to "home"). */
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  onToggleTheme?: (mode: ThemeMode) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * HomeScreen — the student's "Bosh sahifa" (docs/04 §4.1, §4.5). Composed
 * entirely from `shared/ui` + `widgets` + tokens. Presentational and
 * prop-driven: it fetches nothing and owns no state.
 *
 * Layout is full-width (docs/04 §4.10): AppShell frame → greeting header
 * (Govo + localized greeting) → a "today" row pairing the daily-goal ring with
 * the streak → the prominent "Continue" card → the module list. Every colour /
 * space / radius / motion value is a token.
 */
export function HomeScreen({
  user,
  dailyGoal,
  streak,
  continueTarget,
  modules,
  mood = "idle",
  onContinue,
  onOpenModule,
  activeNavKey = "home",
  onNavigate,
  onToggleTheme,
}: HomeScreenProps) {
  return (
    <AppShell
      brand={<Brand />}
      nav={{ items: studentNavItems, activeKey: activeNavKey, onNavigate }}
      headerStart={
        <Text as="h1" variant="title-m">
          Bosh
        </Text>
      }
      headerEnd={<ThemeToggle onChange={onToggleTheme} />}
    >
      <div className={styles.page}>
        <GreetingHeader user={user} mood={mood} />

        <section className={styles.today} aria-label="Bugungi holat">
          <DailyGoalCard goal={dailyGoal} />
          <StreakCard streak={streak} />
        </section>

        <ContinueCard target={continueTarget} onContinue={onContinue} />

        <section className={styles.modules} aria-label="Modullar">
          <Text as="h2" variant="label" color="faint" className={styles.sectionLabel}>
            Modullar
          </Text>
          <ul className={styles.moduleList}>
            {modules.map((m) => (
              <li key={m.id}>
                <ModuleCard module={m} onOpenModule={onOpenModule} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Greeting                                                                   */
/* -------------------------------------------------------------------------- */

function GreetingHeader({ user, mood }: { user: HomeUser; mood: MascotMood }) {
  return (
    <header className={styles.greeting}>
      <Mascot mood={mood} size={72} label="Govo" />
      <div className={styles.greetingText}>
        <Text as="p" variant="body-s" color="muted" weight="semibold">
          {user.greeting}
        </Text>
        <div className={styles.greetingName}>
          <Text as="span" variant="title-l">
            {user.name}
          </Text>
          {user.level && (
            <Badge variant="primary" size="md">
              {user.level}
            </Badge>
          )}
        </div>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Daily goal (progress ring — role="progressbar")                            */
/* -------------------------------------------------------------------------- */

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

function DailyGoalCard({ goal }: { goal: HomeDailyGoal }) {
  const unit = goal.unit ?? "daqiqa";
  const pct = clampPct(goal.target > 0 ? (goal.done / goal.target) * 100 : 0);
  const met = goal.done >= goal.target && goal.target > 0;
  const dashoffset = RING_C * (1 - pct / 100);

  return (
    <Card variant="outline" padding="lg" className={styles.goalCard}>
      <div
        className={styles.ring}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={goal.target}
        aria-valuenow={goal.done}
        aria-valuetext={`${goal.done} / ${goal.target} ${unit}`}
        aria-label="Bugungi maqsad"
      >
        <svg className={styles.ringSvg} viewBox="0 0 120 120" aria-hidden>
          <circle className={styles.ringTrack} cx="60" cy="60" r={RING_R} />
          <circle
            className={cx(styles.ringFill, met && styles.ringFillMet)}
            cx="60"
            cy="60"
            r={RING_R}
            strokeDasharray={RING_C}
            strokeDashoffset={dashoffset}
          />
        </svg>
        <div className={styles.ringLabel}>
          <Text as="span" variant="title-m" weight="black" numeric>
            {Math.round(pct)}%
          </Text>
        </div>
      </div>

      <div className={styles.goalMeta}>
        <Text as="p" variant="label" color="primary">
          Bugungi maqsad
        </Text>
        <Text as="p" variant="title-s">
          <Text as="span" variant="title-s" numeric>
            {goal.done}
          </Text>
          <Text as="span" variant="title-s" color="muted" numeric>
            {" / "}
            {goal.target} {unit}
          </Text>
        </Text>
        <Text as="p" variant="body-s" color={met ? "success" : "ink-soft"}>
          {met ? "Bugungi maqsad bajarildi 🎉" : "Kunlik seriyani davom ettir"}
        </Text>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Streak (current + freezes)                                                 */
/* -------------------------------------------------------------------------- */

function StreakCard({ streak }: { streak: HomeStreak }) {
  const lit = streak.todayComplete ?? false;
  return (
    <Card variant="outline" padding="lg" className={styles.streakCard}>
      <div className={cx(styles.flameWrap, lit ? styles.flameLit : styles.flameDim)}>
        <FlameGlyph />
      </div>

      <div className={styles.streakMeta}>
        <Text as="p" variant="label" color="faint">
          Seriya
        </Text>
        <div className={styles.streakNum}>
          <Text as="span" variant="title-l" numeric>
            {streak.current}
          </Text>
          <Text as="span" variant="body" color="muted">
            kun
          </Text>
        </div>

        <div
          className={styles.freezes}
          aria-label={`${streak.freezes} muzlatish qoldi`}
        >
          {Array.from({ length: Math.max(streak.freezes, 0) }, (_, i) => (
            <span key={i} className={styles.freeze} aria-hidden>
              <SnowflakeGlyph />
            </span>
          ))}
          <Text as="span" variant="body-s" color="info" weight="semibold" numeric>
            {streak.freezes} muzlatish
          </Text>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Continue card (docs/04 §4.5 — the retention machine)                       */
/* -------------------------------------------------------------------------- */

function ContinueCard({
  target,
  onContinue,
}: {
  target: HomeContinueTarget;
  onContinue?: () => void;
}) {
  const steps = target.steps;
  return (
    <Card variant="raised" padding="lg" className={styles.continueCard}>
      <div className={styles.continueMascot} aria-hidden>
        <Mascot mood={target.mood ?? "idle"} size={88} label="" />
      </div>

      <div className={styles.continueBody}>
        {target.kicker && (
          <Text as="p" variant="label" color="primary">
            {target.kicker}
          </Text>
        )}

        <div className={styles.continueTitleRow}>
          <Text as="h2" variant="title-l" className={styles.continueTitle}>
            {target.title}
          </Text>
          {target.band && <Badge variant="accent">{target.band}</Badge>}
        </div>

        {target.subtitle && (
          <Text as="p" variant="body-l" color="ink-soft" className={styles.continueSub}>
            {target.subtitle}
          </Text>
        )}

        {steps && steps.total > 0 && (
          <div
            className={styles.steps}
            role="progressbar"
            aria-label="Mashq bosqichlari"
            aria-valuemin={0}
            aria-valuemax={steps.total}
            aria-valuenow={steps.done}
            aria-valuetext={`${steps.total} bosqichdan ${steps.done} tasi bajarildi`}
          >
            {Array.from({ length: steps.total }, (_, i) => (
              <span
                key={i}
                className={cx(styles.step, i < steps.done && styles.stepDone)}
                aria-hidden
              />
            ))}
          </div>
        )}

        <div className={styles.continueActions}>
          <Button variant="primary" size="lg" onClick={onContinue}>
            {target.actionLabel ?? "Boshlash →"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Module list                                                                */
/* -------------------------------------------------------------------------- */

interface ModuleStatusMeta {
  label: string;
  badge: "neutral" | "primary" | "success" | "info";
  tone: Tone;
}

const STATUS_META: Record<ModuleStatus, ModuleStatusMeta> = {
  "not-started": { label: "Yangi", badge: "info", tone: "neutral" },
  "in-progress": { label: "Davom etyapti", badge: "primary", tone: "primary" },
  done: { label: "Yakunlandi", badge: "success", tone: "success" },
  locked: { label: "Qulflangan", badge: "neutral", tone: "muted" },
};

function ModuleCard({
  module,
  onOpenModule,
}: {
  module: HomeModule;
  onOpenModule?: (id: string, module: HomeModule) => void;
}) {
  const meta = STATUS_META[module.status];
  const locked = module.status === "locked";
  const pct = clampPct(module.progress);

  const inner = (
    <>
      <span className={cx(styles.modPct, styles[`modPct-${meta.tone}` as const])}>
        {locked ? (
          <LockGlyph />
        ) : (
          <Text as="span" variant="body-s" weight="black" numeric>
            {Math.round(pct)}%
          </Text>
        )}
      </span>

      <span className={styles.modBody}>
        <span className={styles.modTitleRow}>
          <Text as="span" variant="title-s" truncate>
            {module.name}
          </Text>
          {module.teacher && (
            <Badge variant="accent" size="sm">
              O&apos;qituvchi
            </Badge>
          )}
        </span>

        {(module.level || module.count) && (
          <Text as="span" variant="body-s" color="muted">
            {[module.level, module.count].filter(Boolean).join(" · ")}
          </Text>
        )}

        <span
          className={styles.modBar}
          role="progressbar"
          aria-label={`${module.name} progressi`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <span
            className={cx(styles.modBarFill, styles[`modBar-${meta.tone}` as const])}
            style={{ width: `${pct}%` }}
          />
        </span>
      </span>

      <Badge variant={meta.badge} size="sm" className={styles.modStatus}>
        {meta.label}
      </Badge>
    </>
  );

  if (locked) {
    return (
      <Card variant="flat" padding="md" className={cx(styles.moduleCard, styles.moduleLocked)}>
        {inner}
      </Card>
    );
  }

  return (
    <Card variant="outline" padding="md" interactive asChild>
      <button
        type="button"
        className={styles.moduleCard}
        onClick={() => onOpenModule?.(module.id, module)}
      >
        {inner}
      </button>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

type Tone = "primary" | "success" | "info" | "muted" | "neutral";

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function FlameGlyph() {
  return (
    <svg className={styles.glyph} width="26" height="26" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 3c1 3-2 4-2 7a4 4 0 0 0 8 0c0-1-.5-2-1-2.5.2 2-1 3-1.5 2 .8-3-1.5-5.5-3.5-6.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function SnowflakeGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 2v20M4 7l16 10M20 7 4 17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.9" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.9" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

/**
 * HomeScreenDemo — drop-in standalone preview wired to the mock fixture, so the
 * Home screen renders end-to-end with no backend.
 */
export default function HomeScreenDemo() {
  return (
    <HomeScreen
      user={mockUser}
      dailyGoal={mockDailyGoal}
      streak={mockStreak}
      continueTarget={mockContinue}
      modules={mockModules}
      onContinue={() => undefined}
      onOpenModule={() => undefined}
      onNavigate={() => undefined}
    />
  );
}
