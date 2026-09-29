/**
 * PracticePage (`/task?task=:id`) — the real practice loop. Fetches
 * `GET /api/blocks/student`, resolves the task to answer (the `?task=` id a module
 * row, an assignment, the daily step or a skip passes — else the first actionable
 * task), and drives the PracticeScreen with a CONTROLLED phase.
 *
 * On submit the take is POSTed to `/api/submissions` (multipart) and the page polls
 * `GET /api/submissions/{id}` with a gentle backoff for up to a minute (grading was
 * measured at 9–19 s; the old 24 s ceiling gave up on answers that were about to
 * land). Then, in place — never a toast followed by a different task:
 *   • done    → the result (mockup B6): band, level, the grader's short feedback
 *               from `/api/submissions/{id}/detail`, "Batafsil" to `/results/{id}`,
 *               "Qayta urinish" (same task) and "Keyingi vazifa";
 *   • still grading after the wait → an honest "baholanmoqda — natija Natijalar
 *               bo'limida chiqadi" with a link there, not a dead end;
 *   • failed  → the failure's machine code in words (`results.failure.*`) and a retry.
 *
 * A `?task=` id the student's catalogue does not contain is "not available" — it is
 * never swapped for another task (see `pickPracticeTarget`). A premium-locked task
 * says so BEFORE recording. `?from=daily` (set by the daily session) adds the way back
 * to it on every outcome.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PracticeScreen, PracticeStateScreen } from "../../screens/practice";
import type {
  PracticeFeedback,
  PracticePhase,
  PracticeProgress,
  PracticeTask,
} from "../../screens/practice";
import { endpoints, isApiError } from "../../shared/api";
import type {
  AttemptDetailResponse,
  StudentModuleResponse,
  SubmissionResponse,
} from "../../shared/api";
import {
  gradingFailureKey,
  nextOpenTarget,
  parseCorrections,
  parseFeedback,
  pickPracticeTarget,
} from "../adapters";
import type { PracticeTarget } from "../adapters";
import { levelFromBand } from "../teacherAdapters";
import { PageError, PageLoading, Toast } from "../PageState";
import { useNavHandler } from "../nav";

/** How long to keep asking before saying "still grading". */
export const POLL_BUDGET_MS = 60_000;

/** Wait before the `i`-th poll (0-based): 2 s, 2.5 s, 3 s … capped at 6 s — quick
 * enough to catch a 9 s grade promptly, gentle enough not to hammer the API for a
 * whole minute. Thirteen polls fill the budget. */
export function pollDelay(i: number): number {
  return Math.min(2000 + 500 * i, 6000);
}

/** How many corrections the result shows inline; the rest are behind "Batafsil". */
const INLINE_CORRECTIONS = 3;

interface UiTarget {
  task: PracticeTask;
  progress: PracticeProgress;
  questionId: string;
}

function toUiTarget(picked: PracticeTarget): UiTarget {
  const tk = picked.task;
  const prompt = tk.prompt_text?.trim();
  return {
    questionId: tk.id,
    task: {
      id: tk.id,
      title: tk.title,
      // No prompt from the API (an older image, or a locked task) → the title is the
      // prompt, exactly as before the field existed.
      prompt: prompt || tk.title,
      instruction: tk.instruction_text?.trim() || undefined,
      media:
        tk.media_url && (tk.media_type === "image" || tk.media_type === "video")
          ? { url: tk.media_url, type: tk.media_type }
          : null,
      band: tk.level ?? undefined,
      prepMs: tk.prep_time_sec && tk.prep_time_sec > 0 ? tk.prep_time_sec * 1000 : undefined,
      maxDurationMs:
        tk.answer_time_limit_sec && tk.answer_time_limit_sec > 0
          ? tk.answer_time_limit_sec * 1000
          : undefined,
      premiumLocked: tk.premium_locked,
    },
    progress: { current: picked.index, total: picked.module.total },
  };
}

/** A graded attempt → the result panel. Null when there is no score to show. */
function toFeedback(
  t: TFunction,
  sub: SubmissionResponse,
  detail: AttemptDetailResponse | null,
): PracticeFeedback | null {
  const score = detail?.band ?? detail?.overall_band ?? sub.overall_band;
  if (score === null || score === undefined) return null;
  const rounded = Math.round(score);
  const fb = parseFeedback(detail?.feedback);
  const corrections = parseCorrections(detail?.corrections);
  const scores: Array<[string, number | null | undefined]> = [
    ["fluency", detail?.fluency_score ?? sub.fluency_score],
    ["lexical", detail?.lexical_score ?? sub.lexical_score],
    ["grammar", detail?.grammar_score ?? sub.grammar_score],
    ["pronunciation", detail?.pronunciation_score ?? sub.pronunciation_score],
  ];
  // A criterion never scored is LEFT OUT, not drawn as a zero bar.
  const criteria = scores
    .filter((c): c is [string, number] => typeof c[1] === "number")
    .map(([key, value]) => ({
      id: key,
      label: t(`results.criteria.${key}`),
      score: Math.round(value),
    }));

  return {
    score: rounded,
    band: levelFromBand(rounded),
    summary: fb?.summary ?? "",
    strengths: fb?.strengths.slice(0, 3),
    transcript: detail?.transcript ?? undefined,
    corrections: corrections.slice(0, INLINE_CORRECTIONS).map((c, i) => ({
      id: `c${i}`,
      before: c.original,
      after: c.corrected,
      note: c.explanation || undefined,
    })),
    correctionTotal: corrections.length,
    criteria,
  };
}

/** A refused submit → one localized sentence. Never the server's own text (it used
 * to be shown verbatim: "This task isn't assigned to you…", in English, to a
 * student reading Uzbek). 403 / 404 do not come through here — they end the task
 * rather than invite a retry, and get a state of their own. */
function submitErrorMessage(t: TFunction, err: unknown): string {
  if (isApiError(err)) {
    if (err.status === 429) return t("practice.rateLimited");
    if (err.status === 0) return t("auth.errors.network");
  }
  return t("practice.submitFailed");
}

/**
 * Why there is nothing to answer on this route:
 *   unavailable — the task is not (or no longer) in the student's catalogue: an
 *                 unknown `?task=` id, or a submit answered 404 (soft-deleted);
 *   closed      — it exists but refuses this student's answer: a submit answered
 *                 403 (unpublished, not assigned, deadline passed, no attempts left).
 */
type Blocked = "unavailable" | "closed" | null;

type PollOutcome =
  | { kind: "done"; sub: SubmissionResponse }
  | { kind: "failed"; code: string | null }
  | { kind: "pending" }
  | { kind: "cancelled" };

export default function PracticePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const onNavigate = useNavHandler();
  const [searchParams, setSearchParams] = useSearchParams();
  const taskParam = searchParams.get("task");
  const fromDaily = searchParams.get("from") === "daily";

  const [target, setTarget] = useState<UiTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  /** Nothing is open anywhere (no `?task=`). */
  const [empty, setEmpty] = useState(false);
  /** Nothing to answer here, and why (see {@link Blocked}). */
  const [blocked, setBlocked] = useState<Blocked>(null);
  const [phase, setPhase] = useState<PracticePhase>("idle");
  const [feedback, setFeedback] = useState<PracticeFeedback | null>(null);
  const [failureMessage, setFailureMessage] = useState<string | undefined>(undefined);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  /** Whether another open task exists to skip to — the skip button hides when not. */
  const [canSkip, setCanSkip] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "danger" | "info"; msg: string } | null>(null);

  const alive = useRef(true);
  const toastTimer = useRef<number | null>(null);
  /** The catalogue as last fetched — what skip computes "next" from. */
  const modulesRef = useRef<StudentModuleResponse[]>([]);
  /** The task id this page put in the URL itself, so the URL effect does not reload it. */
  const shownId = useRef<string | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = useCallback((tone: "success" | "danger" | "info", msg: string) => {
    setToast({ tone, msg });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => alive.current && setToast(null), 3500);
  }, []);

  /** Put a resolved target on screen and reset the loop around it. */
  const present = useCallback((picked: PracticeTarget, modules: StudentModuleResponse[]) => {
    modulesRef.current = modules;
    shownId.current = picked.task.id;
    setTarget(toUiTarget(picked));
    setCanSkip(nextOpenTarget(modules, picked.task.id) !== null);
    setEmpty(false);
    setBlocked(null);
    setPhase("idle");
    setFeedback(null);
    setFailureMessage(undefined);
    setSubmissionId(null);
  }, []);

  // Load (or reload) the catalogue and resolve the task to present.
  const load = useCallback(
    async (taskId: string | null) => {
      setLoading(true);
      setError(false);
      try {
        const modules = await endpoints.studentBlocks();
        if (!alive.current) return;
        const picked = pickPracticeTarget(modules, taskId);
        if (picked) {
          present(picked, modules);
        } else {
          modulesRef.current = modules;
          shownId.current = taskId;
          setTarget(null);
          setBlocked(taskId ? "unavailable" : null);
          setEmpty(!taskId);
        }
      } catch {
        if (alive.current) setError(true);
      } finally {
        if (alive.current) setLoading(false);
      }
    },
    [present],
  );

  useEffect(() => {
    // A task this page navigated to itself (skip / next) is already on screen.
    if (taskParam !== null && taskParam === shownId.current) return;
    void load(taskParam);
    // Only when the incoming ?task= changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskParam]);

  /** Move to `picked`, keeping the URL honest (`?task=` names what is on screen). */
  const goTo = useCallback(
    (picked: PracticeTarget, modules: StudentModuleResponse[]) => {
      present(picked, modules);
      setSearchParams(
        fromDaily ? { task: picked.task.id, from: "daily" } : { task: picked.task.id },
        { replace: true },
      );
    },
    [fromDaily, present, setSearchParams],
  );

  // Poll a freshly-created submission to its terminal grading status.
  const pollUntilDone = useCallback(async (id: string): Promise<PollOutcome> => {
    let waited = 0;
    for (let i = 0; waited < POLL_BUDGET_MS; i++) {
      const delay = pollDelay(i);
      await new Promise((r) => setTimeout(r, delay));
      waited += delay;
      if (!alive.current) return { kind: "cancelled" };
      try {
        const s = await endpoints.getSubmission(id);
        if (s.status === "done") return { kind: "done", sub: s };
        if (s.status === "failed") return { kind: "failed", code: s.error_message };
      } catch {
        // transient — keep polling
      }
    }
    return { kind: "pending" };
  }, []);

  const onSubmit = useCallback(
    async (audio: Blob) => {
      if (!target) return;
      setPhase("reviewing"); // Govo "thinking" + grading panel
      setFeedback(null);
      setFailureMessage(undefined);

      let sub: SubmissionResponse;
      try {
        sub = await endpoints.submitAudio({ questionId: target.questionId, audio });
      } catch (err) {
        if (!alive.current) return;
        if (isApiError(err) && err.status === 402) {
          // The lock is shown BEFORE recording now, so this is the stale-catalogue
          // fallback: the gate moved under an open screen. Nothing was stored — the
          // gate runs before the upload — so send them where it can change, with the
          // reason, rather than appearing out of nowhere.
          navigate("/premium", { state: { reason: "paywall" } });
          return;
        }
        if (isApiError(err) && (err.status === 404 || err.status === 403)) {
          // Deleted (404) or no longer open to this student (403): no retry will
          // change it, so the recorder is not offered again — the state says why.
          setBlocked(err.status === 404 ? "unavailable" : "closed");
          setPhase("idle");
          return;
        }
        showToast("danger", submitErrorMessage(t, err));
        setPhase("idle"); // back to the recorder to retry
        return;
      }

      if (!alive.current) return;
      setSubmissionId(sub.id);
      const outcome = await pollUntilDone(sub.id);
      if (!alive.current || outcome.kind === "cancelled") return;

      if (outcome.kind === "failed") {
        setFailureMessage(t(gradingFailureKey(outcome.code)));
        setPhase("failed");
        return;
      }
      if (outcome.kind === "pending") {
        setPhase("pending");
        return;
      }

      // Graded. The detail carries the grader's words; the list row alone still has
      // every score, so a failed detail read degrades the panel instead of losing it.
      const detail = await endpoints.attemptDetail(sub.id).catch(() => null);
      if (!alive.current) return;
      const result = toFeedback(t, outcome.sub, detail);
      if (result) {
        setFeedback(result);
        setPhase("submitted");
      } else {
        setPhase("pending");
      }
    },
    [target, pollUntilDone, showToast, navigate, t],
  );

  const onRetry = useCallback(() => {
    setFeedback(null);
    setFailureMessage(undefined);
    setPhase("idle");
  }, []);

  // Next = the next OPEN task after this one, from a fresh catalogue (the answer
  // just given may have unlocked the task after it). None left → back to Mashq.
  const onNext = useCallback(async () => {
    const current = target?.questionId ?? null;
    try {
      const modules = await endpoints.studentBlocks();
      if (!alive.current) return;
      const next = nextOpenTarget(modules, current);
      if (next) goTo(next, modules);
      else navigate("/practice");
    } catch {
      if (alive.current) showToast("danger", t("errors.loadBody"));
    }
  }, [goTo, navigate, showToast, t, target]);

  // Skip = the same "next open task", but from the catalogue already loaded: the
  // skipped task is unanswered, so nothing about the order has changed.
  const onSkip = useCallback(() => {
    const next = nextOpenTarget(modulesRef.current, target?.questionId ?? null);
    if (next) goTo(next, modulesRef.current);
  }, [goTo, target]);

  const backToDaily = useCallback(() => navigate("/daily"), [navigate]);

  if (error) return <PageError onRetry={() => void load(taskParam)} />;
  if (loading && !target) return <PageLoading />;

  if (blocked) {
    return (
      <PracticeStateScreen
        title={t(`practice.${blocked}.title`)}
        body={t(`practice.${blocked}.body`)}
        actionLabel={fromDaily ? t("practice.backToDaily") : t("practice.unavailable.cta")}
        onAction={() => navigate(fromDaily ? "/daily" : "/practice")}
        onNavigate={onNavigate}
      />
    );
  }
  if (empty || !target) {
    return (
      <PracticeStateScreen
        title={t("practice.empty.title")}
        body={t("practice.emptyBody")}
        actionLabel={t("practice.empty.cta")}
        onAction={() => navigate("/")}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <>
      <PracticeScreen
        task={target.task}
        progress={target.progress}
        phase={phase}
        feedback={feedback}
        failureMessage={failureMessage}
        onSubmit={onSubmit}
        onRetry={onRetry}
        onNext={() => void onNext()}
        onSkip={canSkip ? onSkip : undefined}
        onOpenDetail={submissionId ? () => navigate(`/results/${submissionId}`) : undefined}
        onOpenResults={() => navigate("/results")}
        onOpenPremium={() => navigate("/premium", { state: { reason: "locked" } })}
        onBackToDaily={fromDaily ? backToDaily : undefined}
        activeNavKey="practice"
        onNavigate={onNavigate}
      />
      {toast && <Toast tone={toast.tone}>{toast.msg}</Toast>}
    </>
  );
}
