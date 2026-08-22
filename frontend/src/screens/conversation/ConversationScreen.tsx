import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button, FlowingWaveform, Text, cx } from "../../shared/ui";
import { scenarioIcon } from "./scenarios";
import type { Scenario } from "./scenarios";
import type { RoleplayCorrection } from "./roleplayApi";
import styles from "./ConversationScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One rendered chat bubble. The partner speaks in TEXT (`text`, literal Russian);
 * the student answers only by VOICE, so a user message carries an `audioUrl` +
 * `durationMs` and renders as a playable voice bubble instead of text.
 *
 * A student bubble also carries what speech-to-text actually HEARD (`transcript`)
 * and any coaching on it (`corrections`). Both are shown, side by side and
 * clearly distinguished: the transcript is the student's own words, mistakes
 * included, and the corrections are labelled as corrections. Quietly showing the
 * fixed version in place of the transcript would teach the student that they said
 * it correctly.
 */
export interface ConversationMessage {
  id: string;
  role: "ai" | "user";
  /** Partner reply text (RU). Absent on a student voice message. */
  text?: string;
  /** Student voice take — object URL for in-place playback. */
  audioUrl?: string;
  /** Length of the student's recording, ms (drives the bubble's duration). */
  durationMs?: number;
  /** VERBATIM speech-to-text of this take. Never the corrected form. */
  transcript?: string;
  /** Targeted fixes for this turn, rendered under the bubble. */
  corrections?: RoleplayCorrection[];
}

export interface ConversationScreenProps {
  /** The scenario being played (title / tone / id for the header). */
  scenario: Scenario;
  /** The full transcript so far, oldest → newest. */
  messages: ConversationMessage[];
  /** The partner is composing its next reply — shows the animated indicator. */
  typing: boolean;
  /** The conversation is over — the composer becomes a single "Tugatish". */
  exhausted: boolean;
  /**
   * The feature cannot run right now (flag off, no AI key, budget spent). The mic
   * is replaced by a way out, because a record button that cannot lead anywhere is
   * worse than no button at all.
   */
  blocked?: boolean;
  /** One honest line above the composer — already localized by the page. */
  note?: string;
  /** Turns left in this conversation, shown next to the goal. */
  turnsLeft?: number;
  /** Student finished a voice answer → send it for a real turn. */
  onSend: (blob: Blob, durationMs: number) => void;
  /** "Tugatish" — end the conversation and show the summary. */
  onFinish: () => void;
  /** Header back — leave the conversation. */
  onBack: () => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ConversationScreen (E3) — the Suhbat chat surface.
 *
 * A full-screen focal flow (the same family as Placement): a fixed header (back ·
 * RU scenario title · goal · "Tugatish"), a scrollable transcript of partner text
 * bubbles (left) and student VOICE bubbles (right, `--primary`), and a composer
 * pinned to the bottom. The student answers by voice only — the composer is a
 * record→send mic (no "Yordam", no typed input); the partner replies in text only.
 * Purely presentational: the PAGE owns the conversation and hands down `messages`
 * / `typing` / `exhausted` / `blocked` / `note` plus the callbacks. Every colour /
 * space / radius is a token.
 */
export function ConversationScreen({
  scenario,
  messages,
  typing,
  exhausted,
  blocked = false,
  note,
  turnsLeft,
  onSend,
  onFinish,
  onBack,
}: ConversationScreenProps) {
  const { t } = useTranslation();
  const endRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest bubble (or the typing indicator) in view as the chat grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, typing]);

  return (
    <div className={styles.page}>
      {/* ---- Header ---- */}
      <header className={styles.header}>
        <button
          type="button"
          className={styles.back}
          onClick={onBack}
          aria-label={t("common.back")}
        >
          <BackGlyph />
        </button>

        <div className={styles.headerBody}>
          <div className={styles.titleRow}>
            <span className={styles.headerIcon} aria-hidden>
              {scenarioIcon(scenario.id, scenario.tone, scenario.icon)}
            </span>
            <Text as="h1" variant="title-s" truncate className={styles.headerTitle}>
              {scenario.titleRu}
            </Text>
          </div>
          {/* The goal is fixed for the whole conversation and the turn counter changes
              every send, so the counter never truncates and the goal gives way to it —
              at 375px a single truncating line would eat exactly the number that is
              still moving. */}
          <div className={styles.headerGoal}>
            <Text as="span" variant="body-s" color="muted" truncate className={styles.goalText}>
              {t("suhbat.goalLabel", { goal: scenario.goalUz })}
            </Text>
            {typeof turnsLeft === "number" && (
              <Text as="span" variant="body-s" color="muted" className={styles.turnsLeft}>
                {t("suhbat.turnsLeft", { count: turnsLeft })}
              </Text>
            )}
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={onFinish} className={styles.finish}>
          {t("suhbat.finish")}
        </Button>
      </header>

      {/* ---- Transcript ---- */}
      <div className={styles.thread} role="log" aria-label={scenario.titleRu} aria-live="polite">
        <ul className={styles.messages}>
          {messages.map((m) =>
            m.role === "ai" ? (
              <AiBubble key={m.id} text={m.text ?? ""} />
            ) : (
              <VoiceBubble
                key={m.id}
                audioUrl={m.audioUrl}
                durationMs={m.durationMs ?? 0}
                transcript={m.transcript}
                corrections={m.corrections}
              />
            ),
          )}
        </ul>

        {typing && <TypingIndicator />}

        <div ref={endRef} className={styles.end} aria-hidden />
      </div>

      {/* ---- Composer ---- */}
      <div className={styles.composer}>
        {note && (
          <Text as="p" variant="body-s" color="muted" align="center" className={styles.note}>
            {note}
          </Text>
        )}

        {blocked ? (
          <Button variant="secondary" size="lg" fullWidth onClick={onBack}>
            {t("common.back")}
          </Button>
        ) : exhausted ? (
          <Button variant="primary" size="lg" fullWidth onClick={onFinish}>
            {t("suhbat.finish")}
          </Button>
        ) : (
          <VoiceComposer onSend={onSend} disabled={typing} />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Voice composer — the student's only input: record → send (docs/03 §3.6).   */
/* -------------------------------------------------------------------------- */

type ComposerStatus = "idle" | "requesting" | "recording" | "denied" | "error";

/** First supported container/codec, or undefined to let the browser choose. */
function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const c of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ]) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* isTypeSupported can throw on odd inputs — try the next. */
    }
  }
  return undefined;
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Feature-detect the (prefixed) AudioContext without tripping SSR / TS. */
function getAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

/**
 * VoiceComposer — a compact record→send control (the chat-sized sibling of the
 * full `Recorder`). Idle shows a mic button; recording shows a cancel · live
 * timer · stop-and-send row. Stopping emits `onSend(blob, durationMs)` straight
 * away (there is no separate review step — "faqat ovoz yozib yuborish"); cancel
 * discards the take. Every browser API is feature-detected and torn down on
 * unmount. `disabled` gates the mic while the AI is "typing".
 */
function VoiceComposer({
  onSend,
  disabled,
}: {
  onSend: (blob: Blob, durationMs: number) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ComposerStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  // Live analyser drives the radial equalizer; null while idle / on teardown.
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // `onstop` fires for both send and cancel; this flag tells them apart.
  const emitRef = useRef(true);

  const supported = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof window !== "undefined" &&
      "MediaRecorder" in window,
    [],
  );

  const clearTick = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  /** Stop the mic tracks + close the Web-Audio graph feeding the equalizer. */
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    setAnalyser(null);
  }, []);

  // Hard teardown on unmount — refs / DOM only, no setState.
  useEffect(() => {
    return () => {
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
      const rec = recRef.current;
      if (rec && rec.state !== "inactive") {
        rec.onstop = null;
        try {
          rec.stop();
        } catch {
          /* already stopping */
        }
      }
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      audioCtxRef.current?.close().catch(() => undefined);
    };
  }, []);

  const start = useCallback(async () => {
    if (!supported) {
      setStatus("error");
      return;
    }
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Web-Audio graph feeding the live radial equalizer. Best-effort: if the
      // AudioContext is unavailable the recording still works, just without the
      // visual. NOT connected to destination (no mic playback).
      const Ctor = getAudioContextCtor();
      if (Ctor) {
        try {
          const audioCtx = new Ctor();
          const source = audioCtx.createMediaStreamSource(stream);
          const node = audioCtx.createAnalyser();
          node.fftSize = 256;
          node.smoothingTimeConstant = 0.8;
          source.connect(node);
          audioCtxRef.current = audioCtx;
          setAnalyser(node);
        } catch {
          /* no visualizer — recording is unaffected. */
        }
      }

      const type = pickMime();
      chunksRef.current = [];
      emitRef.current = true;

      let rec: MediaRecorder;
      try {
        rec = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
      } catch {
        stopStream();
        setStatus("error");
        return;
      }

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        clearTick();
        const emit = emitRef.current;
        const duration = performance.now() - startedAtRef.current;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || type || "audio/webm" });
        stopStream();
        setStatus("idle");
        setElapsedMs(0);
        if (emit && blob.size > 0) onSend(blob, duration);
      };
      recRef.current = rec;

      startedAtRef.current = performance.now();
      setElapsedMs(0);
      rec.start();
      setStatus("recording");
      tickRef.current = window.setInterval(() => {
        setElapsedMs(performance.now() - startedAtRef.current);
      }, 200);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : (err as Error)?.name;
      setStatus(
        name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError"
          ? "denied"
          : "error",
      );
    }
  }, [supported, clearTick, stopStream, onSend]);

  const stopAndSend = useCallback(() => {
    emitRef.current = true;
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* already stopping */
      }
    }
  }, []);

  const cancel = useCallback(() => {
    emitRef.current = false;
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* already stopping */
      }
    } else {
      clearTick();
      stopStream();
      setStatus("idle");
      setElapsedMs(0);
    }
  }, [clearTick, stopStream]);

  if (status === "denied" || status === "error") {
    return (
      <div className={styles.composerState} role="alert">
        <Text as="p" variant="body-s" color="danger" align="center">
          {status === "denied" ? t("suhbat.micDenied") : t("suhbat.micError")}
        </Text>
        <Button variant="secondary" size="sm" onClick={() => setStatus("idle")}>
          {t("suhbat.retry")}
        </Button>
      </div>
    );
  }

  if (status === "recording") {
    return (
      <div className={styles.recording}>
        {/* Status, then the live flowing waveform straight on the composer
            surface (no dark band), then the controls. */}
        <span className={styles.recMeta}>
          <span className={styles.pulseDot} aria-hidden />
          <Text as="span" variant="body-s" color="danger" weight="bold">
            {t("suhbat.recording")}
          </Text>
          <span className={styles.recTimer} aria-hidden>
            {formatTime(elapsedMs)}
          </span>
        </span>

        <FlowingWaveform analyser={analyser} height={120} className={styles.wave} />

        <div className={styles.recActions}>
          <Button variant="ghost" size="md" onClick={cancel}>
            {t("suhbat.cancel")}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={stopAndSend}
            className={styles.sendBtn}
          >
            <span className={styles.sendIcon} aria-hidden>
              <SendIcon />
            </span>
            {t("suhbat.send")}
          </Button>
        </div>
      </div>
    );
  }

  // idle / requesting
  return (
    <Button
      variant="primary"
      size="lg"
      fullWidth
      loading={status === "requesting"}
      disabled={disabled || !supported}
      onClick={start}
      className={styles.record}
    >
      <span className={styles.recordIcon} aria-hidden>
        <MicIcon />
      </span>
      {t("suhbat.answer")}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* Bubbles                                                                     */
/* -------------------------------------------------------------------------- */

function AiBubble({ text }: { text: string }) {
  return (
    <li className={cx(styles.msg, styles.msgAi)}>
      <span className={cx(styles.bubble, styles.bubbleAi)}>
        <Text as="span" variant="body" className={styles.bubbleText}>
          {text}
        </Text>
      </span>
    </li>
  );
}

/**
 * The student's voice answer — a playable bubble (play/pause · label · length),
 * with what speech-to-text HEARD underneath it and any coaching below that.
 *
 * The transcript is printed exactly as it came back. It is the record of what the
 * student said, so a wrong case ending stays wrong here and is fixed, visibly and
 * separately, in the coach row: «shunday dedingiz → shunday to'g'ri». Rewriting
 * the transcript into the corrected sentence would erase the only evidence the
 * student has that anything needed correcting.
 */
function VoiceBubble({
  audioUrl,
  durationMs,
  transcript,
  corrections,
}: {
  audioUrl?: string;
  durationMs: number;
  transcript?: string;
  corrections?: RoleplayCorrection[];
}) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => undefined);
    else el.pause();
  }, []);

  return (
    <li className={cx(styles.msg, styles.msgUser, styles.msgUserCol)}>
      <span className={cx(styles.bubble, styles.bubbleUser)}>
        <span className={styles.voice}>
          <button
            type="button"
            className={styles.voicePlay}
            onClick={toggle}
            disabled={!audioUrl}
            aria-label={playing ? t("suhbat.pause") : t("suhbat.listen")}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>

          <span className={styles.voiceInfo}>
            <Text as="span" variant="body-s" weight="bold" className={styles.voiceLabel}>
              {t("suhbat.voiceMessage")}
            </Text>
            <span className={styles.voiceDur} aria-hidden>
              {formatTime(durationMs)}
            </span>
          </span>
        </span>

        {transcript !== undefined && (
          <span className={styles.heard}>
            <Text as="span" variant="body-s" className={styles.heardText}>
              {transcript.trim().length > 0 ? transcript : t("suhbat.heardNothing")}
            </Text>
          </span>
        )}

        {audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
        )}
      </span>

      {corrections && corrections.length > 0 && (
        <ul className={styles.coach} aria-label={t("suhbat.coachLabel")}>
          {corrections.map((c, i) => (
            <li key={i} className={styles.coachRow}>
              <Text as="span" variant="body-s" className={styles.coachFix}>
                <s className={styles.coachWas}>{c.original}</s>
                <span aria-hidden> → </span>
                <b>{c.corrected}</b>
              </Text>
              {c.explanation && (
                <Text as="span" variant="body-s" color="muted" className={styles.coachWhy}>
                  {c.explanation}
                </Text>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Typing indicator                                                           */
/* -------------------------------------------------------------------------- */

function TypingIndicator() {
  const { t } = useTranslation();
  return (
    <div className={cx(styles.msg, styles.msgAi)}>
      <span className={cx(styles.bubble, styles.bubbleAi, styles.typing)}>
        <span className={styles.dots} aria-hidden>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </span>
        <Text as="span" variant="body-s" color="muted">
          {t("suhbat.typingHint")}
        </Text>
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Glyphs                                                                      */
/* -------------------------------------------------------------------------- */

function BackGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        d="M15 5l-7 7 7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="var(--primary-on)" />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v3"
        stroke="var(--primary-on)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 12l15-7-7 15-2-6-6-2z"
        fill="var(--primary-on)"
        stroke="var(--primary-on)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path d="M8 5.5v13l11-6.5z" fill="var(--primary-on)" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <rect x="7" y="5" width="4" height="14" rx="1.4" fill="var(--primary-on)" />
      <rect x="13" y="5" width="4" height="14" rx="1.4" fill="var(--primary-on)" />
    </svg>
  );
}
