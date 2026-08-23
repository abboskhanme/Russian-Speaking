/**
 * PracticePage (`/practice`) — the real practice loop. Fetches
 * `GET /api/blocks/student`, resolves the task to answer (the `?task=` id Home
 * passes, else the first actionable task), and drives the PracticeScreen with a
 * CONTROLLED phase so submit outcomes (402 paywall / 403 deadline / network)
 * surface cleanly. On submit the take is POSTed to `/api/submissions` (multipart)
 * and we poll `GET /api/submissions/{id}` to the terminal grading status, then
 * advance to the next actionable task.
 *
 * Note: the Practice slice's `SubmissionResponse` intentionally omits the
 * transcript/evaluation (grading detail lands in a later backend phase), so we
 * show the real grading/pending state and a submitted confirmation rather than
 * fabricating a score.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PracticeScreen } from "../../screens/practice";
import type {
  PracticePhase,
  PracticeProgress,
  PracticeTask,
} from "../../screens/practice";
import { endpoints, isApiError } from "../../shared/api";
import type { StudentModuleResponse } from "../../shared/api";
import { pickPracticeTarget } from "../adapters";
import { PageError, PageLoading, Toast } from "../PageState";
import { useNavHandler } from "../nav";

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_TRIES = 12; // ~24s

interface UiTarget {
  task: PracticeTask;
  progress: PracticeProgress;
  questionId: string;
}

function buildTarget(modules: StudentModuleResponse[], taskId?: string | null): UiTarget | null {
  const picked = pickPracticeTarget(modules, taskId);
  if (!picked) return null;
  return {
    questionId: picked.task.id,
    task: {
      id: picked.task.id,
      prompt: picked.task.title,
      band: picked.task.level ?? undefined,
    },
    progress: { current: picked.index, total: picked.module.total },
  };
}

export default function PracticePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const onNavigate = useNavHandler();
  const [searchParams] = useSearchParams();
  const initialTaskId = searchParams.get("task");

  const [target, setTarget] = useState<UiTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [phase, setPhase] = useState<PracticePhase>("idle");
  const [toast, setToast] = useState<{ tone: "success" | "danger" | "info"; msg: string } | null>(null);

  const alive = useRef(true);
  const toastTimer = useRef<number | null>(null);
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

  // Load (or reload) the catalogue and resolve the next task to present.
  const load = useCallback(
    async (preferTaskId?: string | null) => {
      setLoading(true);
      setError(false);
      setEmpty(false);
      try {
        const modules = await endpoints.studentBlocks();
        if (!alive.current) return;
        const next = buildTarget(modules, preferTaskId);
        setTarget(next);
        setEmpty(next === null);
        setPhase("idle");
      } catch {
        if (alive.current) setError(true);
      } finally {
        if (alive.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(initialTaskId);
    // Only on first mount / when the incoming ?task= changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTaskId]);

  // Poll a freshly-created submission to its terminal grading status.
  const pollUntilDone = useCallback(async (id: string) => {
    for (let i = 0; i < POLL_MAX_TRIES; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (!alive.current) return "cancelled" as const;
      try {
        const s = await endpoints.getSubmission(id);
        if (s.status === "done") return "done" as const;
        if (s.status === "failed") return s.error_message || ("failed" as const);
      } catch {
        // transient — keep polling
      }
    }
    return "pending" as const;
  }, []);

  const onSubmit = useCallback(
    async (audio: Blob) => {
      if (!target) return;
      setPhase("reviewing"); // Govo "thinking" + grading panel
      try {
        const sub = await endpoints.submitAudio({ questionId: target.questionId, audio });
        const outcome = await pollUntilDone(sub.id);
        if (!alive.current) return;
        if (outcome === "cancelled") return;
        if (outcome === "done") showToast("success", t("practice.submitDone"));
        else if (outcome === "pending") showToast("info", t("practice.submitGrading"));
        else showToast("danger", typeof outcome === "string" ? outcome : t("practice.submitFailed"));
        // Advance to the next actionable task (the completed one is now done).
        await load(null);
      } catch (err) {
        if (!alive.current) return;
        let msg = t("practice.submitFailed");
        if (isApiError(err)) {
          if (err.status === 402) {
            // The paywall is not a failure to report and move on from — it is a dead end for
            // this task until something changes. Send them where that can change, carrying the
            // reason so the destination says WHY it opened rather than appearing out of
            // nowhere. Nothing was stored: the gate runs before the upload.
            navigate("/premium", { state: { reason: "paywall" } });
            return;
          }
          if (err.status === 403) msg = err.detail || t("practice.forbidden");
          else if (err.status === 0) msg = t("auth.errors.network");
          else if (err.detail) msg = err.detail;
        }
        showToast("danger", msg);
        setPhase("idle"); // back to the recorder to retry
      }
    },
    [target, pollUntilDone, showToast, load, navigate, t],
  );

  const onRetry = useCallback(() => setPhase("idle"), []);
  const onNext = useCallback(() => void load(null), [load]);
  const onSkip = useCallback(() => void load(null), [load]);

  if (error) return <PageError onRetry={() => void load(initialTaskId)} />;
  if (loading || (!target && !empty)) return <PageLoading />;
  if (empty || !target) {
    return (
      <PageError
        message={t("practice.emptyBody")}
        onRetry={() => navigate("/")}
      />
    );
  }

  return (
    <>
      <PracticeScreen
        task={target.task}
        progress={target.progress}
        phase={phase}
        feedback={null}
        onSubmit={onSubmit}
        onRetry={onRetry}
        onNext={onNext}
        onSkip={onSkip}
        activeNavKey="practice"
        onNavigate={onNavigate}
      />
      {toast && <Toast tone={toast.tone}>{toast.msg}</Toast>}
    </>
  );
}
