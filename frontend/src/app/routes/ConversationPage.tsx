/**
 * ConversationPage (`/chat/:scenarioId`) — the Suhbat chat (E3) + summary (E4),
 * driven by a STUB turn engine (the live AI is not wired). The page reads the
 * scenario id from the route, looks it up in the static `scenarios.ts` data
 * (an unknown id redirects to `/practice`), and owns all turn state:
 *
 *   • `messages`   — the transcript, seeded with the scenario's opening AI line.
 *   • `turnIndex`  — how many student→AI pairs have played (== turns taken).
 *   • `typing`     — the AI "typing…" delay between the student turn and its reply.
 *   • `done`       — swaps the chat for the summary.
 *
 * The student answers only by VOICE: recording a take appends a playable voice
 * bubble, then (after a short typing delay) the scripted AI TEXT reply — a
 * believable turn-based demo with no STT/LLM. The scenario's scripted `user`
 * lines are intentionally NOT shown (the student speaks instead); only the
 * scripted `ai` replies are used. Running out of scripted turns, or "Tugatish",
 * ends the run and shows the summary; "Yana urinish" resets it. The voice
 * bubbles hold object URLs, so the page revokes them on reset / unmount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  ConversationScreen,
  ConversationSummary,
  getScenario,
} from "../../screens/conversation";
import type {
  ConversationMessage,
  ScenarioScript,
} from "../../screens/conversation";

/** The AI "typing…" delay between the student's take and the scripted reply. */
const TYPING_MS = 850;

export default function ConversationPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const scenario = getScenario(scenarioId);

  // Unknown scenario → back to the hub rather than a dead chat.
  if (!scenario) return <Navigate to="/practice" replace />;

  // Re-key on the id so switching scenarios fully resets the turn engine.
  return <ConversationFlow key={scenario.id} scenario={scenario} />;
}

/* -------------------------------------------------------------------------- */
/* The turn engine                                                            */
/* -------------------------------------------------------------------------- */

function ConversationFlow({ scenario }: { scenario: ScenarioScript }) {
  const navigate = useNavigate();

  const idRef = useRef(1);
  const timerRef = useRef<number | null>(null);
  // Object URLs minted for the student's voice bubbles — revoked on reset/unmount.
  const audioUrlsRef = useRef<string[]>([]);

  const [messages, setMessages] = useState<ConversationMessage[]>(() => [
    { id: "m0", role: "ai", text: scenario.opening },
  ]);
  const [turnIndex, setTurnIndex] = useState(0);
  const [typing, setTyping] = useState(false);
  const [done, setDone] = useState(false);

  const total = scenario.turns.length;
  const exhausted = turnIndex >= total;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const revokeAudio = useCallback(() => {
    audioUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    audioUrlsRef.current = [];
  }, []);

  // Drop any pending "typing" timeout and free the recorded blobs on unmount.
  useEffect(() => {
    return () => {
      clearTimer();
      revokeAudio();
    };
  }, [clearTimer, revokeAudio]);

  const nextId = () => `m${idRef.current++}`;

  const handleSend = useCallback(
    (blob: Blob, durationMs: number) => {
      if (typing) return;

      // No scripted turns left → the composer is already "Tugatish", but guard.
      if (turnIndex >= total) {
        clearTimer();
        setDone(true);
        return;
      }

      const turn = scenario.turns[turnIndex];
      const url = URL.createObjectURL(blob);
      audioUrlsRef.current.push(url);

      // Append the student's voice take now, then the AI reply after a delay.
      const userMsg: ConversationMessage = {
        id: nextId(),
        role: "user",
        audioUrl: url,
        durationMs,
      };
      setMessages((prev) => [...prev, userMsg]);
      setTyping(true);

      clearTimer();
      timerRef.current = window.setTimeout(() => {
        const aiMsg: ConversationMessage = {
          id: nextId(),
          role: "ai",
          text: turn.ai,
        };
        setMessages((prev) => [...prev, aiMsg]);
        setTyping(false);
        setTurnIndex((i) => i + 1);
        timerRef.current = null;
      }, TYPING_MS);
    },
    [typing, turnIndex, total, scenario, clearTimer],
  );

  const handleFinish = useCallback(() => {
    clearTimer();
    setTyping(false);
    setDone(true);
  }, [clearTimer]);

  const handleRetry = useCallback(() => {
    clearTimer();
    revokeAudio();
    idRef.current = 1;
    setMessages([{ id: "m0", role: "ai", text: scenario.opening }]);
    setTurnIndex(0);
    setTyping(false);
    setDone(false);
  }, [clearTimer, revokeAudio, scenario]);

  const handleBack = useCallback(() => navigate("/practice"), [navigate]);

  if (done) {
    const completed = turnIndex;
    // Reached the goal once at least half the scripted exchanges are done.
    const goalReached = completed >= Math.ceil(total / 2);
    // A stubbed, deterministic fluency read that rises with engagement.
    const fluency = Math.min(92, 60 + completed * 8);

    return (
      <ConversationSummary
        scenario={scenario}
        goalReached={goalReached}
        turns={completed}
        fluency={fluency}
        phrases={scenario.phrases}
        onRetry={handleRetry}
        onBack={handleBack}
      />
    );
  }

  return (
    <ConversationScreen
      scenario={scenario}
      messages={messages}
      typing={typing}
      exhausted={exhausted}
      onSend={handleSend}
      onFinish={handleFinish}
      onBack={handleBack}
    />
  );
}
