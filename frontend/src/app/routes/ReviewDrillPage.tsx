/**
 * ReviewDrillPage (`/review`) — the F5 xato-replay drill (docs/08 Faza 6.1).
 *
 *   • `GET  /api/review/drill`        → one session's worth of due cards
 *   • `POST /api/review/{id}/answer`  → the student's verdict, which moves the
 *     item along the SRS ladder and out of today's queue
 *
 * `/review` is the path the server's `review_added` notification has always
 * linked to, so this screen is what finally answers that link instead of the
 * router's catch-all bouncing it to Home. It sits in the student subtree with
 * `activeNavKey="practice"`: the drill is a way to practise, not a sixth
 * destination, and the 5-item bar stays 5 items.
 *
 * **Flag handling.** The drill ships behind `review_drill_enabled` and the route
 * answers 404 while that is off. A 404 here is therefore not an error state — it
 * means "not shipped in this deployment", and the page leaves for Mashq rather
 * than showing a broken screen for a feature that was never turned on.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ReviewDrillScreen } from "../../screens/review";
import type { DrillVerdict, ReviewDrillCard } from "../../screens/review";
import { endpoints, isApiError } from "../../shared/api";
import type { ReviewDrillItemResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

/** Wire row → the screen's card model. */
function toCard(item: ReviewDrillItemResponse): ReviewDrillCard {
  return {
    id: item.id,
    title: item.question_title,
    promptText: item.prompt_text,
    instructionText: item.instruction_text,
    modelAnswerText: item.model_answer_text,
    topic: item.question_topic,
    level: item.question_level,
    weaknessDim: item.weakness_dim,
    round: item.round,
    totalRounds: item.total_rounds,
  };
}

export default function ReviewDrillPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const onNavigate = useNavHandler();

  const [cards, setCards] = useState<ReviewDrillCard[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);

    endpoints
      .reviewDrill(controller.signal)
      .then((session) => {
        if (!alive.current) return;
        setCards(session.items.map(toCard));
        setDueCount(session.due_count);
        setIndex(0);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive.current || controller.signal.aborted) return;
        // Flag off → the feature does not exist here; go where the student meant
        // to be instead of parking them on an error for a missing feature.
        if (isApiError(e) && e.status === 404) {
          navigate("/practice", { replace: true });
          return;
        }
        setFailed(true);
        setLoading(false);
      });

    return () => controller.abort();
  }, [navigate, reloadKey]);

  const handleAnswer = useCallback(
    async (verdict: DrillVerdict) => {
      const card = cards[index];
      if (!card || busy) return;
      setBusy(true);
      setAnswerError(null);
      try {
        const res = await endpoints.answerReview(card.id, verdict);
        if (!alive.current) return;
        // The backlog figure comes from the server's recount, never from a local
        // decrement — a second device drilling the same queue changes it too.
        setDueCount(res.remaining_due);
        setIndex((i) => i + 1);
      } catch {
        if (!alive.current) return;
        setAnswerError(t("review.answerError"));
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [busy, cards, index, t],
  );

  const exit = useCallback(() => navigate("/practice"), [navigate]);

  if (loading) return <PageLoading />;
  if (failed) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  // "Finished" means the session was worked through, which is a different state
  // from "nothing was due" — the screen says different things about each.
  const finished = cards.length > 0 && index >= cards.length;

  return (
    <ReviewDrillScreen
      card={finished ? null : (cards[index] ?? null)}
      position={Math.min(index + 1, cards.length)}
      sessionSize={cards.length}
      dueCount={dueCount}
      answered={index}
      finished={finished}
      busy={busy}
      error={answerError}
      onAnswer={handleAnswer}
      onExit={exit}
      onNavigate={onNavigate}
    />
  );
}
