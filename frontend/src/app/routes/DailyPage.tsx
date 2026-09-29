/**
 * DailyPage (`/daily`) — F3 · «Bugungi 5 daqiqa» (docs/04 §4.5, docs/08 Faza 6.3).
 *
 *   • `GET /api/daily?tz_offset=…` → today's session: warm-up → one task → one
 *     drill, stable for the student's whole day
 *
 * **Flag handling.** The session ships behind `daily_five_enabled` and the route
 * answers 404 while that is off. A 404 here is not an error — it means "not
 * shipped in this deployment", and the page leaves for Home rather than showing
 * a broken screen for a feature nobody turned on. This mirrors `/review`.
 *
 * **Where the warm-up's progress lives.** Steps two and three are observable on
 * the server (a submission, an answered review), so the session resumes itself
 * after the student comes back from Mashq or the drill. The warm-up is not: it is
 * three sentences read out loud and it writes nothing anywhere. Rather than
 * inventing a table to record that, it is remembered in `localStorage` under the
 * DAY — the one piece of state that is genuinely per-device, per-day and worth
 * nothing to anyone else. A cleared browser costs the student thirty seconds of
 * re-reading, which is the correct price for not owning a migration.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DailyScreen } from "../../screens/daily";
import type { DailyStep, DailyStepKind } from "../../screens/daily";
import { endpoints, isApiError } from "../../shared/api";
import type { DailySessionResponse, DailyStepResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

/** localStorage key holding the day whose warm-up has been read. One key, not
 * one per day, so it cannot grow without bound in a browser nobody clears. */
const WARMUP_KEY = "govori-daily-warmup";

/** Kinds the screen knows how to render. An unrecognised kind from a newer server
 * is dropped rather than rendered blank — the session still runs, one step
 * shorter, which is a better failure than a card with nothing on it. */
const KNOWN_KINDS: readonly string[] = ["warmup", "task", "drill"];

function readWarmupDay(): string | null {
  // Storage throws in a few real contexts (Safari private mode, site-data blocked),
  // and a warm-up marker is never worth taking the page down for.
  try {
    return localStorage.getItem(WARMUP_KEY);
  } catch {
    return null;
  }
}

function writeWarmupDay(day: string): void {
  try {
    localStorage.setItem(WARMUP_KEY, day);
  } catch {
    /* ignore — the step simply repeats on the next visit */
  }
}

/** Wire row → the screen's step model. */
function toStep(step: DailyStepResponse, warmupDone: boolean): DailyStep {
  return {
    kind: step.kind as DailyStepKind,
    // The server cannot see the warm-up, so the client supplies that one bit and
    // every other `done` still comes from the server's own observation.
    done: step.kind === "warmup" ? warmupDone : step.done,
    estSeconds: step.est_seconds,
    phrases: step.phrases,
    taskId: step.task_id,
    taskTitle: step.task_title,
    moduleName: step.module_name,
    level: step.level,
    dueCount: step.due_count,
  };
}

export default function DailyPage() {
  const navigate = useNavigate();
  const onNavigate = useNavHandler();

  const [session, setSession] = useState<DailySessionResponse | null>(null);
  const [warmupDay, setWarmupDay] = useState<string | null>(readWarmupDay);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    setFailed(false);

    endpoints
      .dailySession(controller.signal)
      .then((data) => {
        if (!alive) return;
        setSession(data);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive || controller.signal.aborted) return;
        // Flag off → the feature does not exist here; go where the student meant
        // to be instead of parking them on an error for a missing feature.
        if (isApiError(e) && e.status === 404) {
          navigate("/", { replace: true });
          return;
        }
        setFailed(true);
        setLoading(false);
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [navigate, reloadKey]);

  const steps = useMemo<DailyStep[]>(() => {
    if (!session) return [];
    const warmupDone = warmupDay === session.day;
    return session.steps
      .filter((s) => KNOWN_KINDS.includes(s.kind))
      .map((s) => toStep(s, warmupDone));
  }, [session, warmupDay]);

  // The first unfinished step, or -1 once every one of them is done. Derived
  // rather than stored, so returning from Mashq with a fresh fetch lands on the
  // right step without the page having to remember where it was.
  const activeIndex = steps.findIndex((s) => !s.done);

  const finishWarmup = useCallback(() => {
    if (!session) return;
    writeWarmupDay(session.day);
    setWarmupDay(session.day);
  }, [session]);

  // `from=daily` makes the task screen offer "Bugungi mashg'ulotga qaytish" on its
  // result, so the student is brought back HERE for the next step instead of being
  // left in Mashq wondering where the session went.
  const openTask = useCallback(
    (taskId: string) => navigate(`/task?task=${encodeURIComponent(taskId)}&from=daily`),
    [navigate],
  );

  if (loading) return <PageLoading />;
  if (failed || !session) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <DailyScreen
      day={session.day}
      streak={session.streak}
      steps={steps}
      activeIndex={activeIndex}
      onFinishWarmup={finishWarmup}
      onOpenTask={openTask}
      onOpenDrill={() => navigate("/review")}
      onExit={() => navigate("/")}
      onKeepPractising={() => navigate("/practice")}
      activeNavKey="home"
      onNavigate={onNavigate}
    />
  );
}
