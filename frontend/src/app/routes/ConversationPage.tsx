/**
 * ConversationPage (`/chat/:scenarioId`) — the Suhbat chat (E3) + summary (E4),
 * driven by the real roleplay backend (docs/08 Faza 6.5).
 *
 * What used to happen here: a static script from `scenarios.ts`, a `setTimeout`
 * pretending to be the AI thinking, and a fluency number computed from how many
 * times the student had tapped send. What happens now: `POST /roleplay/…` opens a
 * conversation, every recording is uploaded and transcribed, the partner's reply
 * depends on what the AI made of what was actually said, and the wrap-up numbers
 * come from grades that were really given.
 *
 * Three behaviours are deliberate:
 *
 *   • **The voice bubble appears immediately, before the round-trip.** A student
 *     who has just spoken should see their turn land; waiting for STT would make
 *     the app feel like it had dropped the recording. The bubble is then patched
 *     with the transcript when it arrives.
 *   • **A failed turn does not erase the take.** The bubble stays, an honest line
 *     appears above the composer, and the student can speak again.
 *   • **A non-`ready` state is not an error.** Flag off / no key / budget spent
 *     each render the chat read-only with the reason written out, rather than a
 *     toast and a dead mic.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  ConversationScreen,
  ConversationSummary,
  endRoleplay,
  getScenario,
  roleplayNoteKey,
  sendRoleplayTurn,
  startRoleplay,
  toScenario,
} from "../../screens/conversation";
import type {
  ConversationMessage,
  RoleplayCorrection,
  RoleplayState,
  RoleplaySummary,
  Scenario,
} from "../../screens/conversation";
import { PageLoading } from "../PageState";
import { isApiError } from "../../shared/api";

export default function ConversationPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();

  if (!scenarioId) return <Navigate to="/chat" replace />;

  // Re-key on the slug so switching scenarios starts a genuinely new conversation
  // rather than reusing the previous one's id.
  return <ConversationFlow key={scenarioId} slug={scenarioId} />;
}

/* -------------------------------------------------------------------------- */
/* The conversation                                                           */
/* -------------------------------------------------------------------------- */

function ConversationFlow({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const idRef = useRef(1);
  // Object URLs minted for the student's voice bubbles — revoked on reset/unmount.
  const audioUrlsRef = useRef<string[]>([]);

  const [booting, setBooting] = useState(true);
  const [gone, setGone] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  // The bundled scenario is the immediate header: the API sends none for a feature
  // it will not run, and a header reading "undefined" makes a deliberate state look
  // like a crash.
  const [scenario, setScenario] = useState<Scenario | undefined>(() => getScenario(slug));
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [state, setState] = useState<RoleplayState>("ready");
  const [sending, setSending] = useState(false);
  const [turnsLeft, setTurnsLeft] = useState<number | undefined>(undefined);
  const [finished, setFinished] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [summary, setSummary] = useState<RoleplaySummary | null>(null);

  const revokeAudio = useCallback(() => {
    audioUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    audioUrlsRef.current = [];
  }, []);

  useEffect(() => revokeAudio, [revokeAudio]);

  const open = useCallback(async () => {
    setBooting(true);
    setFailure(undefined);
    try {
      const started = await startRoleplay(slug);
      setState(started.state);
      setConversationId(started.conversation_id);
      setTurnsLeft(started.state === "ready" ? started.turns_left : undefined);
      if (started.scenario) setScenario(toScenario(started.scenario));
      setMessages(
        started.opening_ru
          ? [{ id: "m0", role: "ai", text: started.opening_ru }]
          : [],
      );
    } catch (e) {
      // A slug the server has never heard of is the one case with nothing to show.
      if (isApiError(e) && e.status === 404) setGone(true);
      else setFailure(t("suhbat.turnFailed"));
    } finally {
      setBooting(false);
    }
  }, [slug, t]);

  useEffect(() => {
    void open();
  }, [open]);

  const nextId = () => `m${idRef.current++}`;

  const handleSend = useCallback(
    async (blob: Blob, durationMs: number) => {
      if (!conversationId || sending || finished) return;

      const url = URL.createObjectURL(blob);
      audioUrlsRef.current.push(url);
      const bubbleId = nextId();

      // Land the take first, transcribe second — see the file header.
      setMessages((prev) => [
        ...prev,
        { id: bubbleId, role: "user", audioUrl: url, durationMs },
      ]);
      setSending(true);
      setFailure(undefined);

      try {
        const turn = await sendRoleplayTurn(conversationId, blob, durationMs);
        setState(turn.state);

        if (turn.state !== "ready") {
          setSending(false);
          return;                                   // the note explains it; the take stays
        }

        setMessages((prev) => [
          ...prev.map((m) =>
            m.id === bubbleId
              ? {
                  ...m,
                  transcript: turn.student_text ?? "",
                  corrections: turn.corrections as RoleplayCorrection[],
                }
              : m,
          ),
          { id: nextId(), role: "ai" as const, text: turn.partner_ru },
        ]);
        setTurnsLeft(turn.turns_left);
        setFinished(turn.finished);
      } catch {
        setFailure(t("suhbat.turnFailed"));
      } finally {
        setSending(false);
      }
    },
    [conversationId, sending, finished, t],
  );

  const handleFinish = useCallback(async () => {
    if (!conversationId) {
      navigate("/chat");
      return;
    }
    try {
      setSummary(await endRoleplay(conversationId));
    } catch {
      setFailure(t("suhbat.turnFailed"));
    }
  }, [conversationId, navigate, t]);

  const handleRetry = useCallback(() => {
    revokeAudio();
    idRef.current = 1;
    setSummary(null);
    setFinished(false);
    setMessages([]);
    void open();
  }, [open, revokeAudio]);

  const handleBack = useCallback(() => navigate("/chat"), [navigate]);

  if (gone) return <Navigate to="/chat" replace />;
  if (booting || !scenario) return <PageLoading />;

  if (summary) {
    return (
      <ConversationSummary
        scenario={scenario}
        goalReached={summary.goal_reached}
        turns={summary.turns}
        fluency={summary.fluency}
        phrases={summary.phrases}
        corrections={summary.corrections}
        onRetry={handleRetry}
        onBack={handleBack}
      />
    );
  }

  const noteKey = roleplayNoteKey(state);
  const blocked = state !== "ready";

  return (
    <ConversationScreen
      scenario={scenario}
      messages={messages}
      typing={sending}
      exhausted={finished}
      blocked={blocked}
      note={failure ?? (noteKey ? t(noteKey) : undefined)}
      turnsLeft={blocked ? undefined : turnsLeft}
      onSend={(blob, ms) => void handleSend(blob, ms)}
      onFinish={() => void handleFinish()}
      onBack={handleBack}
    />
  );
}
