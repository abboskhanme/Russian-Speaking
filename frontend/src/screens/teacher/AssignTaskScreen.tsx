import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Badge, Button, Card, Input, Modal, Text, cx } from "../../shared/ui";
import { Page } from "../../widgets";
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
  /** Set when it cannot be assigned right now (a module with no published task),
   * already localized. The picker shows the row DISABLED with this reason rather
   * than hiding it — a module that silently vanished from the list reads as a bug. */
  disabledReason?: string;
}

/**
 * One module of the OFFICIAL catalog with its live tasks — D3's "Rasmiy katalog".
 * The teacher did not author these, and may hand out either: the module goes out
 * as a module assign, a task as a single assign — exactly like their own content
 * (`kind` decides, as everywhere else).
 */
export interface AssignOfficialModule {
  module: AssignSelection;
  tasks: AssignSelection[];
}

/** One student as the assign target — A6's "Topshiriq berish" (`?student=`). */
export interface AssignStudentTarget {
  id: string;
  name: string;
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
  /** Single task only: how many of the targeted students already had it OPEN and
   * were therefore skipped (targets − students who got a row). Absent when the
   * response cannot say — a module skips per task, not per student. */
  alreadyHad?: number;
  /** Set when the write failed — already localized by the page. */
  error?: string;
}

export interface AssignTaskProps {
  tasks: AssignSelection[];
  modules: AssignSelection[];
  /** The official catalog, listed in its own labelled section after the
   * teacher's own content. Empty (or absent) when there is none. */
  official?: AssignOfficialModule[];
  groups: AssignGroupOption[];
  /** Preselected group, from `?group=` when arriving from A2 / A5. */
  initialGroupId?: string | null;
  /**
   * A6's "Topshiriq berish": ONE student, from `?student=`. When set, "Kimga" shows
   * that student instead of the group picker and the write goes to `student_ids`.
   */
  student?: AssignStudentTarget | null;
  /** `?student=` named someone outside the teacher's roster (or unresolvable). */
  studentMissing?: boolean;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  queuedCount?: number;
  onBack?: () => void;
  onAssign?: (args: {
    selection: AssignSelection;
    /** Exactly one of these is set. */
    groupId: string | null;
    studentId: string | null;
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
 * teacher's own roster and skips a task a student still has open, so the number
 * created is legitimately allowed to be smaller than the number offered — the line
 * says how many got it AND how many already had it.
 *
 * **One press, one write.** After a success the button goes inert ("Berildi") until
 * the teacher changes what, whom, when or how many — a second tap used to hand the
 * same group the same task again.
 *
 * **A6 targets ONE student** (`?student=`): "Kimga" then names that student instead
 * of offering groups, and the write goes out as `student_ids`.
 *
 * **The official catalog is offered beside the teacher's own content**, in its own
 * "Rasmiy katalog" section: most classes work through it, and a teacher who has
 * authored nothing must still be able to set homework from it. The "no content"
 * empty state is therefore shown only when BOTH sources are empty.
 */
export function AssignTaskScreen({
  tasks,
  modules,
  official = [],
  groups,
  initialGroupId = null,
  student = null,
  studentMissing = false,
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
  /** True after a SUCCESSFUL write, until any input changes. */
  const [done, setDone] = useState(false);

  const group = useMemo(() => groups.find((g) => g.id === groupId) ?? null, [groups, groupId]);
  const hasTarget = student !== null || group !== null;
  // Own content AND the official catalog — a teacher with no content of their own
  // can still assign from the official one.
  const nothingToAssign = tasks.length === 0 && modules.length === 0 && official.length === 0;
  const ready = selection !== null && hasTarget && !busy && !done;

  /** Any change re-arms the button and clears the last outcome. */
  const touched = () => {
    setDone(false);
    setOutcome(null);
  };

  const submit = async () => {
    if (!ready || !selection) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await onAssign?.({
        selection,
        groupId: student ? null : (group?.id ?? null),
        studentId: student?.id ?? null,
        // A blank input means "no deadline", which is a real, nullable state —
        // not today's date, and not an error.
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        maxAttempts,
      });
      setOutcome(result ?? null);
      setDone(Boolean(result && !result.error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={t("nav.classes")}>
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

        {studentMissing ? (
          <EmptyState
            body={t("teacher.assignTask.studentMissing")}
            action={t("teacher.assignTask.goClasses")}
            onAction={onGoToClasses}
          />
        ) : groups.length === 0 && !student ? (
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
              <Text as="h2" variant="label" color="muted" className={styles.legend}>
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
              <Text as="h2" variant="label" color="muted" className={styles.legend}>
                {t("teacher.assignTask.who")}
              </Text>
              {student ? (
                // One named student — nothing to pick, so no radio group.
                <div className={cx(styles.groupRow, styles.groupRowOn)} data-testid="assign-student">
                  <span className={cx(styles.mark, styles.markOn)} aria-hidden>
                    <CheckGlyph />
                  </span>
                  <Text as="span" variant="body" weight="bold" className={styles.groupName} truncate>
                    {student.name}
                  </Text>
                  <Text as="span" variant="body-s" color="muted">
                    {t("teacher.assignTask.oneStudent")}
                  </Text>
                </div>
              ) : (
              /* Radio semantics, not checkboxes: the endpoint takes ONE group_id,
                  and a multi-select that silently assigned to the last one would
                  be worse than a control that says "one at a time". */
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
                        onClick={() => {
                          setGroupId(g.id);
                          touched();
                        }}
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
              )}
            </section>

            {/* ---- Muddat ---- */}
            <section className={styles.section}>
              <Text as="h2" variant="label" color="muted" className={styles.legend}>
                {t("teacher.assignTask.due")}
              </Text>
              {/* A native datetime input: it renders in the OS locale and needs no
                  Intl call of ours, which matters because Chromium's reduced ICU
                  has no Uzbek calendar data. */}
              <Input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => {
                  setDueAt(e.currentTarget.value);
                  touched();
                }}
                aria-label={t("teacher.assignTask.due")}
              />
              <Text as="p" variant="body-s" color="muted">
                {t("teacher.assignTask.dueHint")}
              </Text>
            </section>

            {/* ---- Urinish ---- */}
            <section className={styles.section}>
              <Text as="h2" variant="label" color="muted" className={styles.legend}>
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
                      onClick={() => {
                        setMaxAttempts(n);
                        touched();
                      }}
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
                  {outcomeText(t, outcome, selection?.kind ?? "task")}
                </Text>
                {/* The module line can only report rows, not who already had what —
                    so it says the rule instead of a number it cannot know. */}
                {!outcome.error && outcome.created > 0 && outcome.alreadyHad === undefined && (
                  <Text as="p" variant="body-s" color="muted">
                    {t("teacher.assignTask.createdHint")}
                  </Text>
                )}
              </Card>
            )}

            <div className={styles.footer}>
              <Button variant="primary" size="lg" disabled={!ready} onClick={() => void submit()}>
                {done
                  ? t("teacher.assignTask.submitted")
                  : student
                    ? t("teacher.assignTask.submit", { count: 1 })
                    : group
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
          official={official}
          onClose={() => setPickerOpen(false)}
          onPick={(s) => {
            setSelection(s);
            touched();
            setPickerOpen(false);
          }}
        />
      </div>
    </Page>
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
 * Modules come first — a module is the coarser, more common bulk action. The
 * official catalog follows in its own labelled section, each module with its
 * tasks under it. */
function PickerModal({
  open,
  tasks,
  modules,
  official,
  onClose,
  onPick,
}: {
  open: boolean;
  tasks: AssignSelection[];
  modules: AssignSelection[];
  official: AssignOfficialModule[];
  onClose: () => void;
  onPick: (s: AssignSelection) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const match = (s: AssignSelection) =>
    s.title.toLowerCase().includes(query.trim().toLowerCase());
  const shownModules = modules.filter(match);
  const shownTasks = tasks.filter(match);
  // A module whose NAME matches keeps all its tasks; otherwise it stays only as
  // the heading of whichever of its tasks match.
  const shownOfficial = official
    .map((o) => (match(o.module) ? o : { ...o, tasks: o.tasks.filter(match) }))
    .filter((o) => match(o.module) || o.tasks.length > 0);
  const nothing = shownModules.length === 0 && shownTasks.length === 0 && shownOfficial.length === 0;

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
            {shownOfficial.length > 0 && (
              <section
                className={styles.pickerSection}
                aria-label={t("teacher.assignTask.officialSection")}
                data-testid="assign-official"
              >
                <Text as="h3" variant="label" color="muted" className={styles.legend}>
                  {t("teacher.assignTask.officialSection")}
                </Text>
                <Text as="p" variant="body-s" color="muted">
                  {t("teacher.assignTask.officialHint")}
                </Text>
                <ul className={styles.pickerList}>
                  {shownOfficial.map((o) => (
                    <li key={`official:${o.module.id}`} className={styles.officialModule}>
                      <PickerRow item={o.module} onPick={onPick} />
                      {o.tasks.length > 0 && (
                        <ul className={cx(styles.pickerList, styles.officialTasks)}>
                          {o.tasks.map((task) => (
                            <li key={`${task.kind}:${task.id}`}>
                              <PickerRow item={task} onPick={onPick} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
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
      <Text as="h3" variant="label" color="muted" className={styles.legend}>
        {label}
      </Text>
      <ul className={styles.pickerList}>
        {items.map((s) => (
          <li key={`${s.kind}:${s.id}`}>
            <PickerRow item={s} onPick={onPick} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One pickable row — a task or a module, own or official. */
function PickerRow({ item: s, onPick }: { item: AssignSelection; onPick: (s: AssignSelection) => void }) {
  return (
    <button
      type="button"
      className={styles.pickerRow}
      disabled={Boolean(s.disabledReason)}
      onClick={() => onPick(s)}
    >
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
        {/* Visible text, not a tooltip: a disabled button takes no focus and
            shows no tooltip on touch. */}
        {s.disabledReason && (
          <Text as="span" variant="body-s" color="warn">
            {s.disabledReason}
          </Text>
        )}
      </span>
    </button>
  );
}

/**
 * The result line, from what the SERVER did. A single task can say both halves —
 * "2 ta o'quvchiga berildi, 3 tasida allaqachon bor edi" — because the response
 * lists one row per student who got it; a module can only report rows.
 */
function outcomeText(t: TFunction, outcome: AssignOutcome, kind: "task" | "module"): string {
  if (outcome.error) return outcome.error;
  if (outcome.created === 0) return t("teacher.assignTask.createdNone");
  if (kind === "task" && outcome.alreadyHad !== undefined) {
    return outcome.alreadyHad > 0
      ? t("teacher.assignTask.createdSplit", { count: outcome.created, already: outcome.alreadyHad })
      : t("teacher.assignTask.createdStudents", { count: outcome.created });
  }
  return t("teacher.assignTask.created", { count: outcome.created });
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
