import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Input, Modal, Text, cx } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, teacherNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockAssignTask } from "./assign.mock";
import { BackGlyph } from "./TeacherGroupDetailScreen";
import styles from "./AssignTaskScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** The attempt budgets on offer; `null` is Cheksiz and is the default. The server
 * accepts 1–10, so these are a usable subset, not the whole legal range. */
const ATTEMPT_CHOICES: (number | null)[] = [null, 1, 2, 3, 5];

/** Something assignable: a single task, or a whole module's published tasks.
 * `kind` is load-bearing — it picks which endpoint the page calls. */
export interface AssignSelection {
  id: string;
  kind: "task" | "module";
  title: string;
  /** Level / topic line for a task; task count for a module. */
  subtitle?: string;
  /** Modules only: how many published tasks go out with it. */
  taskCount?: number;
}

/** One group the teacher can assign to, with the roster size the button counts. */
export interface AssignGroupOption {
  id: string;
  name: string;
  memberCount: number;
}

/** What the server actually did — never what the UI hoped it would do. */
export interface AssignOutcome {
  /** Rows created. May be smaller than the roster (server-side roster filter) or
   * than `taskCount × students` (duplicates are skipped). */
  created: number;
  /** Set when the write failed; the screen shows it verbatim. */
  error?: string;
}

export interface AssignTaskProps {
  tasks: AssignSelection[];
  modules: AssignSelection[];
  groups: AssignGroupOption[];
  /** Preselected group, from `?group=` when arriving from A2 / A5. */
  initialGroupId?: string | null;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  queuedCount?: number;
  onBack?: () => void;
  onAssign?: (args: {
    selection: AssignSelection;
    groupId: string;
    /** ISO-8601, or null for "no deadline". */
    dueAt: string | null;
    /** Attempts allowed per task, or null for unlimited. */
    maxAttempts: number | null;
  }) => Promise<AssignOutcome> | AssignOutcome;
  /** Escape hatches for the two empty states. */
  onGoToClasses?: () => void;
  onGoToContent?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * AssignTaskScreen — **D3 «Topshiriq berish» (bulk assign)**
 * (`docs/design/mockups/Govorim - Teacher.dc.html`).
 *
 * Vazifa → Kimga → Muddat → one primary action that names the real number of
 * students. Reached from the A2 group cards and the A5 group detail, both of
 * which already navigate here with `?group=`.
 *
 * **A module is a first-class choice, not just a task.** `POST /api/assignments`
 * and `POST /api/assignments/module` both exist, and a teacher who has just built
 * a six-task module in Kontent wants to hand out the module, not six tasks one at
 * a time. The picker keeps the two visibly distinct because their consequences
 * differ.
 *
 * **«Urinish» ships now that the server keeps the rule.** `assignments.max_attempts`
 * exists and submit refuses past it, so the control is a real constraint rather
 * than decoration. Default is **Cheksiz** — unlimited is what every assignment
 * meant before the column existed, and a limit is the deliberate choice.
 *
 * **The button's count comes from the selected group's roster, and the success
 * line comes from the RESPONSE.** The server filters targets through the
 * teacher's own roster and skips tasks a student already has, so the number
 * created is legitimately allowed to be smaller than the number offered — saying
 * so is more useful than hiding it.
 */
export function AssignTaskScreen({
  tasks,
  modules,
  groups,
  initialGroupId = null,
  activeNavKey = "classes",
  onNavigate,
  queuedCount = 0,
  onBack,
  onAssign,
  onGoToClasses,
  onGoToContent,
}: AssignTaskProps) {
  const { t } = useTranslation();

  const [selection, setSelection] = useState<AssignSelection | null>(null);
  const [groupId, setGroupId] = useState<string | null>(
    // Only honour the incoming id if it is really one of this teacher's groups.
    initialGroupId && groups.some((g) => g.id === initialGroupId) ? initialGroupId : null,
  );
  const [dueAt, setDueAt] = useState("");
  // null = Cheksiz. The offered budgets stop well short of the server's ceiling of
  // 10: past a handful, "how many tries" stops being a teaching decision.
  const [maxAttempts, setMaxAttempts] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<AssignOutcome | null>(null);

  const group = useMemo(() => groups.find((g) => g.id === groupId) ?? null, [groups, groupId]);
  const nothingToAssign = tasks.length === 0 && modules.length === 0;
  const ready = selection !== null && group !== null && !busy;

  const submit = async () => {
    if (!ready || !selection || !group) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await onAssign?.({
        selection,
        groupId: group.id,
        // A blank input means "no deadline", which is a real, nullable state —
        // not today's date, and not an error.
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        maxAttempts,
      });
      setOutcome(result ?? null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: teacherNavItems(t, queuedCount),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("nav.classes")}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page} data-density="compact">
        <header className={styles.head}>
          <button
            type="button"
            className={styles.back}
            onClick={onBack}
            aria-label={t("common.back")}
          >
            <BackGlyph />
          </button>
          <Text as="span" variant="title-l" className={styles.title} truncate>
            {t("teacher.assignTask.title")}
          </Text>
        </header>

        {groups.length === 0 ? (
          <EmptyState
            body={t("teacher.assignTask.noGroups")}
            action={t("teacher.assignTask.goClasses")}
            onAction={onGoToClasses}
          />
        ) : nothingToAssign ? (
          <EmptyState
            body={t("teacher.assignTask.noContent")}
            action={t("teacher.assignTask.goContent")}
            onAction={onGoToContent}
          />
        ) : (
          <>
            {/* ---- Vazifa ---- */}
            <section className={styles.section}>
              <Text as="h2" variant="label" color="faint" className={styles.legend}>
                {t("teacher.assignTask.what")}
              </Text>
              <button
                type="button"
                className={cx(styles.pickRow, selection && styles.pickRowFilled)}
                onClick={() => setPickerOpen(true)}
              >
                <span className={cx(styles.pickIcon, selection?.kind === "module" && styles.pickIconModule)} aria-hidden>
                  {selection?.kind === "module" ? <ModuleGlyph /> : <TaskGlyph />}
                </span>
                <span className={styles.pickBody}>
                  <Text as="span" variant="body" weight="bold" truncate>
                    {selection ? selection.title : t("teacher.assignTask.pickPrompt")}
                  </Text>
                  {selection?.subtitle && (
                    <Text as="span" variant="body-s" color="muted" truncate>
                      {selection.subtitle}
                    </Text>
                  )}
                </span>
                {selection?.kind === "module" && (
                  <Badge variant="accent" size="sm">
                    {t("teacher.assignTask.moduleBadge")}
                  </Badge>
                )}
                <ChevronGlyph />
              </button>
            </section>

            {/* ---- Kimga ---- */}
            <section className={styles.section}>
              <Text as="h2" variant="label" color="faint" className={styles.legend}>
                {t("teacher.assignTask.who")}
              </Text>
              {/* Radio semantics, not checkboxes: the endpoint takes ONE group_id,
                  and a multi-select that silently assigned to the last one would
                  be worse than a control that says "one at a time". */}
              <ul className={styles.groupList} role="radiogroup" aria-label={t("teacher.assignTask.who")}>
                {groups.map((g) => {
                  const on = g.id === groupId;
                  return (
                    <li key={g.id}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={cx(styles.groupRow, on && styles.groupRowOn)}
                        onClick={() => setGroupId(g.id)}
                      >
                        <span className={cx(styles.mark, on && styles.markOn)} aria-hidden>
                          {on && <CheckGlyph />}
                        </span>
                        <Text as="span" variant="body" weight="bold" className={styles.groupName} truncate>
                          {g.name}
                        </Text>
                        <Text as="span" variant="body-s" color="muted" numeric>
                          {g.memberCount}
                        </Text>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* ---- Muddat ---- */}
            <section className={styles.section}>
              <Text as="h2" variant="label" color="faint" className={styles.legend}>
                {t("teacher.assignTask.due")}
              </Text>
              {/* A native datetime input: it renders in the OS locale and needs no
                  Intl call of ours, which matters because Chromium's reduced ICU
                  has no Uzbek calendar data. */}
              <Input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.currentTarget.value)}
                aria-label={t("teacher.assignTask.due")}
              />
              <Text as="p" variant="body-s" color="muted">
                {t("teacher.assignTask.dueHint")}
              </Text>
            </section>

            {/* ---- Urinish ---- */}
            <section className={styles.section}>
              <Text as="h2" variant="label" color="faint" className={styles.legend}>
                {t("teacher.assignTask.attempts")}
              </Text>
              <div className={styles.chips} role="group" aria-label={t("teacher.assignTask.attempts")}>
                {ATTEMPT_CHOICES.map((n) => {
                  const on = maxAttempts === n;
                  return (
                    <button
                      key={n ?? "unlimited"}
                      type="button"
                      className={cx(styles.chip, on && styles.chipOn)}
                      aria-pressed={on}
                      onClick={() => setMaxAttempts(n)}
                    >
                      {n === null
                        ? t("teacher.assignTask.attemptsUnlimited")
                        : t("teacher.assignTask.attemptsN", { count: n })}
                    </button>
                  );
                })}
              </div>
              <Text as="p" variant="body-s" color="muted">
                {t("teacher.assignTask.attemptsHint")}
              </Text>
            </section>

            {outcome && (
              <Card
                variant="outline"
                padding="md"
                className={cx(styles.outcome, outcome.error && styles.outcomeError)}
                role="status"
              >
                <Text as="p" variant="body" weight="semibold">
                  {outcome.error
                    ? outcome.error
                    : outcome.created === 0
                      ? t("teacher.assignTask.createdNone")
                      : t("teacher.assignTask.created", { count: outcome.created })}
                </Text>
                {!outcome.error && outcome.created > 0 && (
                  <Text as="p" variant="body-s" color="muted">
                    {t("teacher.assignTask.createdHint")}
                  </Text>
                )}
              </Card>
            )}

            <div className={styles.footer}>
              <Button variant="primary" size="lg" disabled={!ready} onClick={() => void submit()}>
                {group
                  ? t("teacher.assignTask.submit", { count: group.memberCount })
                  : t("teacher.assignTask.submitIdle")}
              </Button>
            </div>
          </>
        )}

        <PickerModal
          open={pickerOpen}
          tasks={tasks}
          modules={modules}
          onClose={() => setPickerOpen(false)}
          onPick={(s) => {
            setSelection(s);
            setOutcome(null);
            setPickerOpen(false);
          }}
        />
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                      */
/* -------------------------------------------------------------------------- */

function EmptyState({
  body,
  action,
  onAction,
}: {
  body: string;
  action: string;
  onAction?: () => void;
}) {
  return (
    <Card variant="flat" padding="lg" className={styles.empty}>
      <Text as="p" variant="body" color="muted">
        {body}
      </Text>
      <Button variant="secondary" size="sm" onClick={onAction}>
        {action}
      </Button>
    </Card>
  );
}

/** C5-style full-size picker: the task library and the module list, searchable.
 * Modules come first — a module is the coarser, more common bulk action. */
function PickerModal({
  open,
  tasks,
  modules,
  onClose,
  onPick,
}: {
  open: boolean;
  tasks: AssignSelection[];
  modules: AssignSelection[];
  onClose: () => void;
  onPick: (s: AssignSelection) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const match = (s: AssignSelection) =>
    s.title.toLowerCase().includes(query.trim().toLowerCase());
  const shownModules = modules.filter(match);
  const shownTasks = tasks.filter(match);
  const nothing = shownModules.length === 0 && shownTasks.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("teacher.assignTask.pickTitle")}
      closeLabel={t("common.close")}
      size="full"
    >
      <div className={styles.sheet}>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder={t("teacher.searchTask")}
          aria-label={t("teacher.searchTask")}
        />

        {nothing ? (
          <Text as="p" variant="body" color="muted">
            {t("teacher.noMatches")}
          </Text>
        ) : (
          <>
            {shownModules.length > 0 && (
              <PickerGroup
                label={t("teacher.tabModules")}
                items={shownModules}
                onPick={onPick}
              />
            )}
            {shownTasks.length > 0 && (
              <PickerGroup label={t("teacher.tabTasks")} items={shownTasks} onPick={onPick} />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function PickerGroup({
  label,
  items,
  onPick,
}: {
  label: string;
  items: AssignSelection[];
  onPick: (s: AssignSelection) => void;
}) {
  return (
    <section className={styles.pickerSection}>
      <Text as="h3" variant="label" color="faint" className={styles.legend}>
        {label}
      </Text>
      <ul className={styles.pickerList}>
        {items.map((s) => (
          <li key={`${s.kind}:${s.id}`}>
            <button type="button" className={styles.pickerRow} onClick={() => onPick(s)}>
              <span
                className={cx(styles.pickIcon, s.kind === "module" && styles.pickIconModule)}
                aria-hidden
              >
                {s.kind === "module" ? <ModuleGlyph /> : <TaskGlyph />}
              </span>
              <span className={styles.pickBody}>
                <Text as="span" variant="body" weight="bold" truncate>
                  {s.title}
                </Text>
                {s.subtitle && (
                  <Text as="span" variant="body-s" color="muted" truncate>
                    {s.subtitle}
                  </Text>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---- Glyphs (teacher panel's own set; sized to the 22–34px slots) ---- */

function TaskGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="3" width="14" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 8h6M9 12h6M9 16h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ModuleGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3 3 8l9 5 9-5zM3 13l9 5 9-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function AssignTaskDemo() {
  return <AssignTaskScreen {...mockAssignTask} />;
}
