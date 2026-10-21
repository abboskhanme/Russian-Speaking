import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Badge, Card, EmptyState, Text, cx } from "../../../shared/ui";
import { ModuleCover } from "../ModuleCover";
import styles from "./ModulesTab.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** A module is either public (freemium-gated) or shared with the student's group. */
export type ModuleVisibility = "public" | "group";

/**
 * One row of the Modullar list (D1/E1). The presentational shape the page maps
 * `StudentModuleResponse` onto — no wire fields leak in here.
 */
export interface PracticeModule {
  id: string;
  name: string;
  /** CEFR level tag (e.g. "A2"); null renders an em-dash in the meta line. */
  level: string | null;
  total: number;
  /** Completed task count (`done_count`). */
  done: number;
  visibility: ModuleVisibility;
  /**
   * Freemium / sequential gate: the module has no actionable next task yet is
   * not finished, so the student cannot open it without Pro. Derived by the page
   * from `next_task_id === null && done_count < total`.
   */
  locked: boolean;
}

/** The three filter pills above the list. */
export type ModulesFilter = "all" | "active" | "done";

export interface ModulesTabProps {
  modules: PracticeModule[];
  /** Open a module's detail screen (D2). */
  onOpenModule: (id: string) => void;
}

/* -------------------------------------------------------------------------- */
/* Tab                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * ModulesTab — the "Modullar" tab body of the Mashq hub (D1/E1).
 *
 * A filter-pill row (Hammasi / Davom etayotgan / Yakunlangan) over the module
 * cards. Each card carries a state chip (progress % / check / up-arrow / lock),
 * the name, a meta line and a progress bar; a `group`-visibility module also
 * flags the teacher badge.
 *
 * Presentational and prop-driven: it fetches nothing and owns only the filter
 * selection. Layout is full-width; every colour / space / radius / motion value
 * is a token, and all copy resolves through `mashq.modules.*`. The shell owns the
 * `role="tabpanel"` wrapper.
 */
export function ModulesTab({ modules, onOpenModule }: ModulesTabProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ModulesFilter>("all");

  // Recompute state per module once, then filter — cheap, but keeps the render
  // body declarative and the filter logic in exactly one place.
  const rows = useMemo(
    () => modules.map((m) => ({ module: m, state: moduleState(m) })),
    [modules],
  );
  const visible = rows.filter(({ state }) => matchesFilter(state, filter));

  return (
    <div className={styles.tab}>
      {/* ---- Filter pills ---- */}
      <div className={styles.filters} role="group" aria-label={t("mashq.modules.heading")}>
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            className={cx(styles.filterPill, filter === key && styles.filterActive)}
            onClick={() => setFilter(key)}
          >
            {t(`mashq.modules.filter.${key}`)}
          </button>
        ))}
      </div>

      {/* ---- Module list ---- */}
      {visible.length === 0 ? (
        <EmptyState
          compact
          mood={filter === "all" ? "sleepy" : "idle"}
          title={t(`motivation.empty.modules.${filter}Title`)}
          body={t(`motivation.empty.modules.${filter}Body`)}
          // A filtered-out list is not empty: the one step is to see them all.
          actionLabel={filter === "all" ? undefined : t("motivation.empty.modules.showAll")}
          onAction={filter === "all" ? undefined : () => setFilter("all")}
        />
      ) : (
        <ul className={styles.list}>
          {visible.map(({ module, state }) => (
            <li key={module.id} className={styles.listItem}>
              <ModuleCard module={module} state={state} onOpen={onOpenModule} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Module card                                                                */
/* -------------------------------------------------------------------------- */

type ModuleState = "in-progress" | "done" | "not-started" | "locked";

function ModuleCard({
  module,
  state,
  onOpen,
}: {
  module: PracticeModule;
  state: ModuleState;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const pct = module.total > 0 ? Math.round((module.done / module.total) * 100) : 0;
  const fill = state === "done" ? 100 : pct;

  return (
    <Card
      variant="panel"
      padding="none"
      interactive
      asChild
      className={styles.card}
    >
      <button type="button" className={styles.cardBtn} onClick={() => onOpen(module.id)}>
        {/* An illustrated cover per module (deterministic from its id), with a
            small state badge: play to start, check when done, lock when gated,
            the percentage while in progress. */}
        <ModuleCover id={module.id} name={module.name} dimmed={state === "locked"}>
          <span className={cx(styles.badge, CHIP_CLASS[state])}>
            {state === "in-progress" ? (
              <span className={styles.badgePct}>{pct}%</span>
            ) : state === "done" ? (
              <CheckGlyph />
            ) : state === "locked" ? (
              <LockGlyph />
            ) : (
              <PlayGlyph />
            )}
          </span>
        </ModuleCover>

        <span className={styles.cardBody}>
          <span className={styles.nameRow}>
            <Text as="span" variant="title-s" truncate className={styles.name}>
              {module.name}
            </Text>
            {module.visibility === "group" && (
              <Badge variant="accent" size="sm" className={styles.teacherBadge}>
                {t("mashq.modules.teacherBadge")}
              </Badge>
            )}
          </span>

          <Text as="span" variant="body-s" color="muted" className={styles.meta}>
            {metaLine(t, module, state)}
          </Text>

          {/* Decorative — the meta line above already states the count in words. */}
          {state !== "locked" && (
            <span className={styles.bar} aria-hidden>
              <span
                className={cx(styles.barFill, BAR_CLASS[state])}
                style={{ width: `${fill}%` }}
              />
            </span>
          )}
        </span>
      </button>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

const FILTERS: ModulesFilter[] = ["all", "active", "done"];

/** Priority order: a locked module is locked first; a finished one is done; any
 * progress makes it in-progress; otherwise it has not been started. */
function moduleState(m: PracticeModule): ModuleState {
  if (m.locked) return "locked";
  if (m.total > 0 && m.done >= m.total) return "done";
  if (m.done > 0) return "in-progress";
  return "not-started";
}

/** "Hammasi" shows everything (not-started only lives here); "Davom etayotgan"
 * is the in-progress set; "Yakunlangan" is the done set. */
function matchesFilter(state: ModuleState, filter: ModulesFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return state === "in-progress";
  return state === "done";
}

/** The meta line. A module with no CEFR level drops the level part entirely —
 * a leading "— ·" read as a broken value, not as "no level". */
function metaLine(t: TFunction, m: PracticeModule, state: ModuleState): string {
  const level = m.level ?? "";
  let s: string;
  switch (state) {
    case "done":
      s = t("mashq.modules.metaDone", { level, done: m.done, total: m.total });
      break;
    case "locked":
      s = t("mashq.modules.metaLocked", { level });
      break;
    case "not-started":
      s = t("mashq.modules.metaNotStarted", { level, total: m.total });
      break;
    default:
      s = t("mashq.modules.meta", { level, done: m.done, total: m.total });
  }
  return m.level ? s : s.replace(/^\s*·\s*/, "");
}

const CHIP_CLASS: Record<ModuleState, string> = {
  "in-progress": styles.chipInfo,
  done: styles.chipSuccess,
  "not-started": styles.chipPlay,
  locked: styles.chipLocked,
};

const BAR_CLASS: Record<ModuleState, string> = {
  "in-progress": styles.barInfo,
  done: styles.barDone,
  "not-started": styles.barIdle,
  locked: styles.barIdle,
};

function CheckGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5 10 17l9-10"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" stroke="currentColor" strokeWidth="1.9" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
