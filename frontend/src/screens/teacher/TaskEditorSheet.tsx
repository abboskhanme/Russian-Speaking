import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button, Card, Input, Modal, Switch, Text } from "../../shared/ui";
import { ChoiceChips, LevelChips } from "./ChoiceChips";
import type { ChoiceChip } from "./ChoiceChips";
import styles from "./TaskEditorSheet.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** A task as the editor needs it — everything a teacher can change, plus the
 * facts that shape the warnings (answers already given, the module it sits in). */
export interface EditableTask {
  id: string;
  title: string;
  /** The Russian prompt the student speaks about. */
  prompt: string;
  instruction?: string | null;
  modelAnswer?: string | null;
  level?: string | null;
  topic?: string | null;
  prepTimeSec: number;
  answerTimeLimitSec: number;
  published: boolean;
  /** Attempts already recorded — an edit changes what future answers are graded against. */
  submissionCount: number;
  /** Presigned url of the task's image / short video, or null when it has none. */
  mediaUrl?: string | null;
  /** Module it belongs to; absent/null when unattached. */
  moduleName?: string | null;
}

/** A module the create sheet can put the new task into (Vazifalar tab). */
export interface TaskModuleOption {
  id: string;
  name: string;
  published: boolean;
}

/** The create form's payload. */
export interface NewTaskDraft {
  title: string;
  prompt: string;
  instruction?: string;
  modelAnswer?: string;
  level?: string;
  topic?: string;
  prepTimeSec?: number;
  answerTimeLimitSec?: number;
  /** The module to create it in, from the Vazifalar-tab picker. null = unattached.
   * Absent inside a module editor, whose own module is implied. */
  moduleId?: string | null;
  /**
   * Optional cover. The task has no id until it is created, so the PAGE creates
   * first and then uploads; a failed upload leaves a real, saved task with no
   * media, which the page reports rather than pretending the save failed.
   */
  media?: File | null;
}

/** An edit: only the fields the teacher changed. A blank string clears the field
 * server-side (PATCH semantics); title and prompt can never be blanked. */
export interface TaskPatch {
  title?: string;
  prompt?: string;
  instruction?: string;
  modelAnswer?: string;
  level?: string;
  topic?: string;
  prepTimeSec?: number;
  answerTimeLimitSec?: number;
}

export interface TaskEditorSheetProps {
  open: boolean;
  onClose: () => void;
  /** The LIVE task being edited (read by id from the host's list, never a copy
   * taken when the sheet opened). Absent ⇒ create mode. */
  task?: EditableTask | null;
  /** Create mode, inside a module: the module is fixed; its state decides whether
   * the new task goes live at once (it inherits it). */
  fixedModule?: { name: string; published: boolean } | null;
  /** Create mode, from the Vazifalar tab: the modules to choose from. */
  modules?: TaskModuleOption[];
  onCreate?: (draft: NewTaskDraft) => Promise<void>;
  onSave?: (taskId: string, patch: TaskPatch) => Promise<void>;
  onTogglePublished?: (taskId: string, next: boolean) => Promise<void>;
  /** Soft delete. Omit and the danger zone is not rendered. */
  onDelete?: (taskId: string) => Promise<void>;
  onSetMedia?: (taskId: string, file: File) => Promise<void>;
  onRemoveMedia?: (taskId: string) => Promise<void>;
}

/** Mirrors the server's allow-list exactly. `image/svg+xml` is absent on both
 * sides: an SVG can carry script and would be a stored-XSS vector once its
 * presigned url is opened. This only filters the OS picker — the server re-checks
 * everything, because an accept attribute is a hint, not a control. */
export const MEDIA_ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/webm";

/** Thinking time before recording starts. 0 = none; the server allows 0–600. */
export const PREP_CHOICES = [0, 10, 30, 60];
/** How long the answer may run. The server allows 10–1800; past three minutes a
 * speaking answer stops being one task. */
export const ANSWER_CHOICES = [30, 45, 60, 120, 180];

/** What a brand-new task gets when the teacher leaves the chips alone — the same
 * defaults the server applies to an absent field (30 s / 120 s). */
const DEFAULT_PREP = 30;
const DEFAULT_ANSWER = 120;

/* -------------------------------------------------------------------------- */
/* Sheet                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * TaskEditorSheet — **C2 «Vazifa yaratish»**, and the same form as the task
 * EDITOR (`Govorim - Teacher.dc.html`). One full-size sheet for both, because a
 * task a teacher cannot fix after saving is a task they will recreate — and the
 * duplicate then splits students' answers across two copies.
 *
 * Time limits are chips, not number fields: the server clamps whatever it gets,
 * so a typed "5" for five minutes would silently become five seconds' worth of
 * nothing. The chips make only sane values expressible.
 *
 * **Delete is a SOFT delete and says so.** The task leaves every list and every
 * student's module, but answers already given — and their grades — stay. The
 * confirm happens INSIDE this sheet: a second dialog on top of a dialog would
 * fight it for focus and Escape.
 */
export function TaskEditorSheet({
  open,
  onClose,
  task,
  fixedModule,
  modules,
  onCreate,
  onSave,
  onTogglePublished,
  onDelete,
  onSetMedia,
  onRemoveMedia,
}: TaskEditorSheetProps) {
  const { t } = useTranslation();
  const editing = Boolean(task);

  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [instruction, setInstruction] = useState("");
  const [modelAnswer, setModelAnswer] = useState("");
  const [level, setLevel] = useState("");
  const [topic, setTopic] = useState("");
  const [prep, setPrep] = useState(DEFAULT_PREP);
  const [answer, setAnswer] = useState(DEFAULT_ANSWER);
  const [moduleId, setModuleId] = useState<string>("");
  const [media, setMedia] = useState<File | null>(null);
  const newMediaRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Seed ONLY when the sheet opens or switches task. The host refetches after a
  // media change or a publish toggle, and re-seeding on every new `task` object
  // would wipe whatever the teacher had typed but not yet saved.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      seededFor.current = null;
      return;
    }
    const key = task?.id ?? "__new__";
    if (seededFor.current === key) return;
    seededFor.current = key;
    setTitle(task?.title ?? "");
    setPrompt(task?.prompt ?? "");
    setInstruction(task?.instruction ?? "");
    setModelAnswer(task?.modelAnswer ?? "");
    setLevel(task?.level?.trim() ?? "");
    setTopic(task?.topic ?? "");
    setPrep(task?.prepTimeSec ?? DEFAULT_PREP);
    setAnswer(task?.answerTimeLimitSec ?? DEFAULT_ANSWER);
    setModuleId("");
    setMedia(null);
    setError(null);
    setConfirmingDelete(false);
  }, [open, task]);

  const patch = task ? diff(task, { title, prompt, instruction, modelAnswer, level, topic, prep, answer }) : {};
  const dirty = Object.keys(patch).length > 0;
  const valid = title.trim().length > 0 && prompt.trim().length > 0;

  const close = () => {
    if (busy) return; // never abandon an in-flight write
    onClose();
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (task) {
        if (!dirty) return;
        await onSave?.(task.id, patch);
      } else {
        await onCreate?.({
          title: title.trim(),
          prompt: prompt.trim(),
          instruction: instruction.trim() || undefined,
          modelAnswer: modelAnswer.trim() || undefined,
          level: level || undefined,
          topic: topic.trim() || undefined,
          prepTimeSec: prep,
          answerTimeLimitSec: answer,
          ...(modules ? { moduleId: moduleId || null } : {}),
          media,
        });
      }
      onClose();
    } catch {
      setError(t("teacher.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!task || !onDelete || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(task.id);
      onClose();
    } catch {
      setError(t("teacher.task.deleteFailed"));
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  };

  const togglePublished = async (next: boolean) => {
    if (!task || !onTogglePublished || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      await onTogglePublished(task.id, next);
    } catch {
      setError(t("teacher.saveFailed"));
    } finally {
      setPublishing(false);
    }
  };

  const pickedModule = modules?.find((m) => m.id === moduleId) ?? null;
  const createReach = !editing ? createReachHint(t, fixedModule, modules ? pickedModule : undefined) : null;

  return (
    <Modal
      open={open}
      onClose={close}
      title={editing ? t("teacher.task.editTitle") : t("teacher.newTaskTitle")}
      closeLabel={t("common.close")}
      size="full"
    >
      <div className={styles.sheet}>
        {task && task.submissionCount > 0 && (
          // Students have already answered it: an edit changes what the NEXT
          // answers are graded against, not the grades already given.
          <Card variant="tint" padding="sm" className={styles.warn}>
            <Text as="p" variant="body-s" weight="semibold">
              {t("teacher.task.answeredWarn", { count: task.submissionCount })}
            </Text>
          </Card>
        )}

        <Input
          label={t("teacher.taskTitle")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("teacher.taskTitlePlaceholder")}
          autoFocus={!editing}
        />

        <TextArea
          label={t("teacher.taskPrompt")}
          value={prompt}
          onChange={setPrompt}
          placeholder={t("teacher.taskPromptPlaceholder")}
          rows={4}
        />

        <TextArea
          label={t("teacher.task.instruction")}
          hint={t("teacher.task.instructionHint")}
          value={instruction}
          onChange={setInstruction}
          rows={2}
        />

        <TextArea
          label={t("teacher.task.modelAnswer")}
          hint={t("teacher.task.modelAnswerHint")}
          value={modelAnswer}
          onChange={setModelAnswer}
          rows={3}
        />

        <LevelChips label={t("teacher.taskLevel")} value={level} stored={task?.level} onChange={setLevel} />

        <Input
          label={t("teacher.task.topic")}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={t("teacher.task.topicPlaceholder")}
        />

        <ChoiceChips
          label={t("teacher.task.prep")}
          options={withCurrent(PREP_CHOICES, task?.prepTimeSec).map((s) => ({
            value: s,
            label: s === 0 ? t("teacher.task.prepNone") : durationLabel(t, s),
          }))}
          value={prep}
          onChange={setPrep}
        />

        <ChoiceChips
          label={t("teacher.task.answerLimit")}
          options={withCurrent(ANSWER_CHOICES, task?.answerTimeLimitSec).map<ChoiceChip<number>>((s) => ({
            value: s,
            label: durationLabel(t, s),
          }))}
          value={answer}
          onChange={setAnswer}
        />

        {modules && (
          <ChoiceChips
            label={t("teacher.task.module")}
            options={[
              { value: "", label: t("teacher.task.noModule") },
              ...modules.map((m) => ({ value: m.id, label: m.name })),
            ]}
            value={moduleId}
            onChange={setModuleId}
          />
        )}

        {/* Media. A new task has no id to upload against yet, so the file is HELD
            and the page uploads it right after the create; an existing task's
            media changes immediately. */}
        {task ? (
          onSetMedia && (
            <div className={styles.field}>
              <Text as="span" variant="body-s" weight="semibold">
                {t("teacher.media")}
              </Text>
              <MediaControl task={task} onSetMedia={onSetMedia} onRemoveMedia={onRemoveMedia} />
            </div>
          )
        ) : (
          <div className={styles.field}>
            <Text as="span" variant="body-s" weight="semibold">
              {t("teacher.media")}
            </Text>
            <div className={styles.mediaRow}>
              <Text as="span" variant="body-s" color="muted" className={styles.grow}>
                {media ? media.name : t("teacher.mediaHint")}
              </Text>
              <input
                ref={newMediaRef}
                type="file"
                accept={MEDIA_ACCEPT}
                className={styles.fileHidden}
                onChange={(e) => setMedia(e.currentTarget.files?.[0] ?? null)}
                aria-label={t("teacher.media")}
              />
              <Button variant="secondary" size="sm" onClick={() => newMediaRef.current?.click()}>
                {media ? t("teacher.mediaReplaceShort") : t("teacher.mediaAddShort")}
              </Button>
            </div>
          </div>
        )}

        {task && onTogglePublished && (
          <div className={styles.switchRow}>
            <span className={styles.switchText}>
              <Text as="span" variant="body" weight="semibold">
                {task.published ? t("teacher.statusActive") : t("teacher.statusDraft")}
              </Text>
              <Text as="span" variant="body-s" color="muted">
                {task.published ? t("teacher.task.publishedHint") : t("teacher.task.draftHint")}
              </Text>
            </span>
            <Switch
              checked={task.published}
              disabled={publishing || busy}
              onChange={(next) => void togglePublished(next)}
              aria-label={t("teacher.task.publishAria", { task: task.title })}
            />
          </div>
        )}

        {createReach && (
          <Text as="p" variant="body-s" color="muted" role="note">
            {createReach}
          </Text>
        )}

        {error && (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {error}
          </Text>
        )}

        <div className={styles.actions}>
          <Button variant="ghost" onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={busy && !confirmingDelete}
            disabled={!valid || (editing && !dirty) || busy}
            onClick={() => void submit()}
          >
            {editing ? t("teacher.saveReview") : t("teacher.task.create")}
          </Button>
        </div>

        {task && onDelete && (
          <div className={styles.danger}>
            {confirmingDelete ? (
              <div className={styles.confirm} role="alertdialog" aria-label={t("teacher.task.deleteTitle")}>
                <Text as="p" variant="body" weight="semibold">
                  {t("teacher.task.deleteConfirm", { task: task.title })}
                </Text>
                <Text as="p" variant="body-s" color="ink-soft">
                  {t("teacher.task.deleteKeeps")}
                </Text>
                <div className={styles.confirmActions}>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmingDelete(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button variant="danger" size="sm" loading={busy} onClick={() => void remove()}>
                    {t("teacher.task.deleteCta")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className={styles.dangerBtn}
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                {t("teacher.task.delete")}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                      */
/* -------------------------------------------------------------------------- */

function TextArea({
  label,
  hint,
  value,
  onChange,
  placeholder,
  rows,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows: number;
}) {
  return (
    <label className={styles.field}>
      <Text as="span" variant="body-s" weight="semibold">
        {label}
      </Text>
      {/* Prompts and model answers are Russian and run to several sentences,
          so a textarea rather than a single-line input. */}
      <textarea
        className={styles.textarea}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {hint && (
        <Text as="span" variant="body-s" color="muted">
          {hint}
        </Text>
      )}
    </label>
  );
}

/**
 * Set, replace or clear an EXISTING task's media — immediately, since the task
 * already has an id. The server's own `detail` on a refused upload says WHICH rule
 * was broken (type vs size), and this is the one place it is worth showing: it is
 * the difference between a fixable mistake and a mystery.
 */
function MediaControl({
  task,
  onSetMedia,
  onRemoveMedia,
}: {
  task: EditableTask;
  onSetMedia: (taskId: string, file: File) => Promise<void>;
  onRemoveMedia?: (taskId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const has = Boolean(task.mediaUrl);

  const pick = async (file: File | null) => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSetMedia(task.id, file);
    } catch {
      setError(t("teacher.task.mediaFailed"));
    } finally {
      setBusy(false);
      // Let the same file be re-picked after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRemoveMedia?.(task.id);
    } catch {
      setError(t("teacher.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.mediaRow}>
      <Text as="span" variant="body-s" color="muted" className={styles.grow}>
        {has ? t("teacher.task.hasMedia") : t("teacher.mediaHint")}
      </Text>
      {/* The real input is driven by the button: a bare file input cannot be
          styled to match, and its "Choose file" text is browser copy in the
          browser's own language. */}
      <input
        ref={inputRef}
        type="file"
        accept={MEDIA_ACCEPT}
        className={styles.fileHidden}
        onChange={(e) => void pick(e.currentTarget.files?.[0] ?? null)}
        aria-label={t(has ? "teacher.mediaReplace" : "teacher.mediaAdd", { task: task.title })}
      />
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
        {has ? t("teacher.mediaReplaceShort") : t("teacher.mediaAddShort")}
      </Button>
      {has && onRemoveMedia && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void clear()}>
          {t("teacher.mediaRemove")}
        </Button>
      )}
      {error && (
        <Text as="p" variant="body-s" color="danger" role="alert" className={styles.fullRow}>
          {error}
        </Text>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** The offered chips, plus the task's current value when it is not one of them —
 * so an existing 90 s limit stays visible and selected instead of vanishing. */
function withCurrent(choices: number[], current?: number): number[] {
  if (current == null || choices.includes(current)) return choices;
  return [...choices, current].sort((a, b) => a - b);
}

/** 45 → "45 s", 120 → "2 daq", 90 → "1 daq 30 s" — from i18n, not Intl. */
export function durationLabel(t: TFunction, sec: number): string {
  if (sec < 60) return t("teacher.task.sec", { count: sec });
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? t("teacher.task.min", { count: m }) : t("teacher.task.minSec", { m, s });
}

/** Only what changed, normalised the way the server stores it (trimmed; blank
 * clears). Sending unchanged fields would be harmless today, but a PATCH that says
 * exactly what the teacher did is the one that stays right when the server's
 * rules change. */
function diff(
  task: EditableTask,
  v: {
    title: string;
    prompt: string;
    instruction: string;
    modelAnswer: string;
    level: string;
    topic: string;
    prep: number;
    answer: number;
  },
): TaskPatch {
  const out: TaskPatch = {};
  const norm = (s?: string | null) => (s ?? "").trim();
  if (norm(v.title) !== norm(task.title)) out.title = v.title.trim();
  if (norm(v.prompt) !== norm(task.prompt)) out.prompt = v.prompt.trim();
  if (norm(v.instruction) !== norm(task.instruction)) out.instruction = v.instruction.trim();
  if (norm(v.modelAnswer) !== norm(task.modelAnswer)) out.modelAnswer = v.modelAnswer.trim();
  if (norm(v.level) !== norm(task.level)) out.level = v.level.trim();
  if (norm(v.topic) !== norm(task.topic)) out.topic = v.topic.trim();
  if (v.prep !== task.prepTimeSec) out.prepTimeSec = v.prep;
  if (v.answer !== task.answerTimeLimitSec) out.answerTimeLimitSec = v.answer;
  return out;
}

/**
 * Where a NEW task will be visible, stated before it is saved. A task created in a
 * module inherits the module's state — live module ⇒ live task at once; draft
 * module ⇒ the task goes out when the module is published. An unattached task
 * starts as a draft and reaches students only once published and assigned.
 *
 * `picked` is `undefined` when there is no picker (module editor) and `null` when
 * the picker is on "Modulsiz".
 */
function createReachHint(
  t: TFunction,
  fixedModule: { name: string; published: boolean } | null | undefined,
  picked: TaskModuleOption | null | undefined,
): string | null {
  const target = picked !== undefined ? picked : fixedModule ?? undefined;
  if (target === undefined) return null;
  if (target === null) return t("teacher.task.reachNone");
  return target.published
    ? t("teacher.task.reachLive", { module: target.name })
    : t("teacher.task.reachDraft", { module: target.name });
}
