import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { cx } from "../utils/cx";
import { Button } from "../Button/Button";
import { Spinner } from "../Spinner/Spinner";
import { Text } from "../Text/Text";
import { Mascot } from "../Mascot/Mascot";
import { Waveform } from "../Waveform/Waveform";
import { FlowingWaveform } from "../FlowingWaveform/FlowingWaveform";
import { VisuallyHidden } from "../VisuallyHidden/VisuallyHidden";
import styles from "./Recorder.module.css";

/** Internal state machine. Core path is idle → recording → review. */
export type RecorderStatus =
  | "idle"
  | "requesting"
  | "prep"
  | "recording"
  | "review"
  | "denied"
  | "error";

/**
 * WHY recording is not possible — each has a different fix, so each gets its own
 * sentence:
 *   insecure    — the page is on plain http:// (not localhost). Browsers hide
 *                 `navigator.mediaDevices` there; it used to be reported as "your
 *                 device doesn't support recording", on phones that do.
 *   unsupported — the browser really has no getUserMedia / MediaRecorder.
 *   noDevice    — no microphone is connected.
 *   busy        — another app (a call, another tab) is holding the microphone.
 *   generic     — anything else.
 */
export type RecorderProblem = "insecure" | "unsupported" | "noDevice" | "busy" | "generic";

/** What this browser/page can do, before anything is asked of the user. */
export function detectRecordingSupport(): "ok" | "insecure" | "unsupported" {
  if (typeof navigator === "undefined" || typeof window === "undefined") return "unsupported";
  const md = navigator.mediaDevices;
  if (md && typeof md.getUserMedia === "function" && "MediaRecorder" in window) return "ok";
  // An insecure origin hides mediaDevices entirely: a URL problem, not the device's.
  if (window.isSecureContext === false) return "insecure";
  return "unsupported";
}

/** A getUserMedia rejection → what the screen says about it. */
export function classifyMediaError(err: unknown): "denied" | RecorderProblem {
  const name = err instanceof DOMException ? err.name : (err as Error | undefined)?.name;
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "denied";
    case "SecurityError":
      return typeof window !== "undefined" && window.isSecureContext === false
        ? "insecure"
        : "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "noDevice";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "busy";
    default:
      return "generic";
  }
}

export interface RecorderLabels {
  idleHint: string;
  start: string;
  requesting: string;
  recording: string;
  stop: string;
  cancel: string;
  prepTitle: string;
  prepHint: string;
  /** Ends the prep countdown early and starts recording ("Tayyorman"). */
  skip: string;
  play: string;
  pause: string;
  reRecord: string;
  accept: string;
  reviewReady: string;
  retry: string;
  deniedTitle: string;
  deniedHint: string;
  /** Generic failure (anything not covered by the specific problems below). */
  errorTitle: string;
  errorHint: string;
  insecureTitle: string;
  insecureHint: string;
  unsupportedTitle: string;
  unsupportedHint: string;
  noDeviceTitle: string;
  noDeviceHint: string;
  busyTitle: string;
  busyHint: string;
  /** Accessible name of the whole recorder region. */
  region: string;
}

/**
 * The built-in labels, from the `recorder.*` keys in the active language.
 * `labels` still overrides any of them per call site.
 */
function useDefaultLabels(): RecorderLabels {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      idleHint: t("recorder.idleHint"),
      start: t("recorder.start"),
      requesting: t("recorder.requesting"),
      recording: t("recorder.recording"),
      stop: t("recorder.stop"),
      cancel: t("recorder.cancel"),
      prepTitle: t("recorder.prepTitle"),
      prepHint: t("recorder.prepHint"),
      skip: t("recorder.skip"),
      play: t("recorder.play"),
      pause: t("recorder.pause"),
      reRecord: t("recorder.reRecord"),
      accept: t("recorder.accept"),
      reviewReady: t("recorder.reviewReady"),
      retry: t("recorder.retry"),
      deniedTitle: t("recorder.deniedTitle"),
      deniedHint: t("recorder.deniedHint"),
      errorTitle: t("recorder.errorTitle"),
      errorHint: t("recorder.errorHint"),
      insecureTitle: t("recorder.insecureTitle"),
      insecureHint: t("recorder.insecureHint"),
      unsupportedTitle: t("recorder.unsupportedTitle"),
      unsupportedHint: t("recorder.unsupportedHint"),
      noDeviceTitle: t("recorder.noDeviceTitle"),
      noDeviceHint: t("recorder.noDeviceHint"),
      busyTitle: t("recorder.busyTitle"),
      busyHint: t("recorder.busyHint"),
      region: t("recorder.region"),
    }),
    [t],
  );
}

export interface RecorderProps
  extends Omit<HTMLAttributes<HTMLElement>, "onError"> {
  /** Fired with the recorded audio Blob when the user accepts the take. */
  onComplete: (blob: Blob) => void;
  /** Fired when the user aborts an in-progress attempt (discards it). */
  onCancel?: () => void;
  /** Hard cap; the recorder auto-stops here and drives the progress bar. */
  maxDurationMs?: number;
  /** Optional "collect your thoughts" countdown before capture (0 = off). */
  prepMs?: number;
  /** Preferred `MediaRecorder` mimeType (feature-checked, falls back). */
  mimeType?: string;
  /** Size of the embedded Govo mascot. */
  mascotSize?: number;
  /** Override any of the built-in (localized, `recorder.*`) strings. */
  labels?: Partial<RecorderLabels>;
  /**
   * Docked mode (the focused `/task` flow). When this prop is PRESENT — even as
   * `null` while the host's ref is still attaching — the controls (mic / stop /
   * send, the live waveform and the timers) are portalled into this element,
   * which the host pins to the bottom of the screen. The inline part keeps only
   * Govo and the words. Absent = the classic all-inline recorder.
   */
  dockTarget?: HTMLElement | null;
  /** Docked mode: a secondary action beside the mic while nothing is being
   *  captured (the task's "Skip"). Hidden while recording and in review. */
  dockAside?: ReactNode;
  /** Reports the internal state, so a host can adapt around it. */
  onStatusChange?: (status: RecorderStatus) => void;
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

/** First supported container/codec, or undefined to let the browser choose. */
function pickMimeType(preferred?: string): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    preferred,
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* isTypeSupported can throw on odd inputs — ignore and try the next. */
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

/** Average a raw amplitude series into `count` evenly-spaced buckets. */
function resampleTo(raw: number[], count: number): number[] {
  if (raw.length === 0) return [];
  const out = new Array<number>(count);
  const per = raw.length / count;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * per);
    const end = Math.max(start + 1, Math.floor((i + 1) * per));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < raw.length; j++) {
      sum += raw[j];
      n++;
    }
    out[i] = n > 0 ? sum / n : 0;
  }
  return out;
}

/**
 * Recorder — audio capture (docs/03 §3.6, docs/08 §4.6). States:
 *   idle → [prep] → recording → review  (+ requesting / denied / error).
 *
 * Captures with `MediaRecorder`, renders a live `FlowingWaveform` from a
 * Web-Audio `AnalyserNode` while recording, shows an elapsed timer + progress
 * toward the cap, and on stop offers playback + re-record + accept. Emits
 * `onComplete(blob)` / `onCancel()` — no upload/backend coupling.
 *
 * Every browser API is feature-detected; an environment that cannot record says
 * WHY up front (see {@link RecorderProblem}) instead of a disabled mic.
 */
export function Recorder({
  onComplete,
  onCancel,
  maxDurationMs = 120_000,
  prepMs = 0,
  mimeType,
  mascotSize = 150,
  labels: labelOverrides,
  dockTarget,
  dockAside,
  onStatusChange,
  className,
  ...rest
}: RecorderProps) {
  const defaultLabels = useDefaultLabels();
  const labels = useMemo(
    () => ({ ...defaultLabels, ...labelOverrides }),
    [defaultLabels, labelOverrides],
  );

  const support = useMemo(detectRecordingSupport, []);
  const supported = support === "ok";
  const docked = dockTarget !== undefined;

  const [status, setStatus] = useState<RecorderStatus>(supported ? "idle" : "error");
  const [problem, setProblem] = useState<RecorderProblem>(
    support === "insecure" ? "insecure" : support === "unsupported" ? "unsupported" : "generic",
  );
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [durationMs, setDurationMs] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playbackMs, setPlaybackMs] = useState(0);
  const [prepRemainingMs, setPrepRemainingMs] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const urlRef = useRef<string | null>(null);
  const peakSamplesRef = useRef<number[]>([]);
  const startedAtRef = useRef(0);
  const prepStartRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const sampleRef = useRef<number | null>(null);
  const prepRef = useRef<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  const fail = useCallback((p: RecorderProblem) => {
    setProblem(p);
    setStatus("error");
  }, []);

  const clearTimers = useCallback(() => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    if (sampleRef.current !== null) window.clearInterval(sampleRef.current);
    tickRef.current = null;
    sampleRef.current = null;
  }, []);

  const clearPrep = useCallback(() => {
    if (prepRef.current !== null) window.clearInterval(prepRef.current);
    prepRef.current = null;
  }, []);

  /** Stop mic tracks + close the audio graph, updating React state. */
  const teardownAudio = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => undefined);
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    setAnalyser(null);
  }, []);

  const finalize = useCallback(
    (type: string) => {
      clearTimers();
      const blob = new Blob(chunksRef.current, {
        type: type || "audio/webm",
      });
      const duration = performance.now() - startedAtRef.current;
      const reviewPeaks = resampleTo(peakSamplesRef.current, 48);
      teardownAudio();

      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      blobRef.current = blob;

      setPeaks(reviewPeaks);
      setDurationMs(duration);
      setAudioUrl(url);
      setPlaying(false);
      setPlaybackMs(0);
      setStatus("review");
    },
    [clearTimers, teardownAudio],
  );

  const stopRecording = useCallback(() => {
    clearTimers();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* already stopping */
      }
    }
  }, [clearTimers]);

  const startTimers = useCallback(() => {
    clearTimers();
    tickRef.current = window.setInterval(() => {
      const e = performance.now() - startedAtRef.current;
      setElapsedMs(e);
      if (Number.isFinite(maxDurationMs) && e >= maxDurationMs) {
        stopRecording();
      }
    }, 200);
    sampleRef.current = window.setInterval(() => {
      const a = analyserRef.current;
      if (!a) return;
      const buf = new Uint8Array(a.fftSize);
      a.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      peakSamplesRef.current.push(Math.min(1, rms * 2.2));
    }, 90);
  }, [clearTimers, maxDurationMs, stopRecording]);

  const startMediaRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const type = pickMimeType(mimeType);
    chunksRef.current = [];
    peakSamplesRef.current = [];

    let rec: MediaRecorder;
    try {
      rec = type
        ? new MediaRecorder(stream, { mimeType: type })
        : new MediaRecorder(stream);
    } catch {
      teardownAudio();
      fail("generic");
      return;
    }

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => finalize(rec.mimeType || type || "");
    recorderRef.current = rec;

    startedAtRef.current = performance.now();
    setElapsedMs(0);
    try {
      rec.start();
    } catch {
      teardownAudio();
      fail("generic");
      return;
    }
    setStatus("recording");
    startTimers();
  }, [fail, finalize, mimeType, startTimers, teardownAudio]);

  const startPrep = useCallback(() => {
    setStatus("prep");
    prepStartRef.current = performance.now();
    setPrepRemainingMs(prepMs);
    prepRef.current = window.setInterval(() => {
      const remain = prepMs - (performance.now() - prepStartRef.current);
      if (remain <= 0) {
        clearPrep();
        startMediaRecorder();
      } else {
        setPrepRemainingMs(remain);
      }
    }, 100);
  }, [clearPrep, prepMs, startMediaRecorder]);

  const endPrepNow = useCallback(() => {
    clearPrep();
    startMediaRecorder();
  }, [clearPrep, startMediaRecorder]);

  const setupGraph = useCallback((stream: MediaStream) => {
    const Ctor = getAudioContextCtor();
    if (!Ctor) return;
    const ctx = new Ctor();
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createAnalyser();
    node.fftSize = 256;
    node.smoothingTimeConstant = 0.8;
    // Intentionally NOT connected to ctx.destination (no live mic playback).
    source.connect(node);
    audioCtxRef.current = ctx;
    analyserRef.current = node;
    setAnalyser(node);
  }, []);

  const requestAndStart = useCallback(async () => {
    if (!supported) {
      fail(support === "insecure" ? "insecure" : "unsupported");
      return;
    }
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setupGraph(stream);
      if (prepMs > 0) startPrep();
      else startMediaRecorder();
    } catch (err) {
      const kind = classifyMediaError(err);
      if (kind === "denied") setStatus("denied");
      else fail(kind);
    }
  }, [fail, prepMs, setupGraph, startMediaRecorder, startPrep, support, supported]);

  const resetToIdle = useCallback(() => {
    clearTimers();
    clearPrep();
    teardownAudio();
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    blobRef.current = null;
    chunksRef.current = [];
    peakSamplesRef.current = [];
    setAudioUrl(null);
    setPeaks([]);
    setDurationMs(0);
    setElapsedMs(0);
    setPlaying(false);
    setPlaybackMs(0);
    setStatus("idle");
  }, [clearPrep, clearTimers, teardownAudio]);

  const cancelRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    resetToIdle();
    onCancel?.();
  }, [onCancel, resetToIdle]);

  const handleAccept = useCallback(() => {
    if (blobRef.current) onComplete(blobRef.current);
  }, [onComplete]);

  const togglePlay = useCallback(() => {
    const el = audioElRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  }, []);

  // Hard teardown on unmount — refs / DOM only, no setState.
  useEffect(() => {
    return () => {
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
      if (sampleRef.current !== null) window.clearInterval(sampleRef.current);
      if (prepRef.current !== null) window.clearInterval(prepRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => undefined);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const showProgress = Number.isFinite(maxDurationMs) && maxDurationMs > 0;
  const progressPct = showProgress
    ? Math.min(100, (elapsedMs / maxDurationMs) * 100)
    : 0;

  const liveMessage =
    status === "requesting"
      ? labels.requesting
      : status === "recording"
        ? labels.recording
        : status === "review"
          ? labels.reviewReady
          : "";

  const problemText: Record<RecorderProblem, [string, string]> = {
    insecure: [labels.insecureTitle, labels.insecureHint],
    unsupported: [labels.unsupportedTitle, labels.unsupportedHint],
    noDevice: [labels.noDeviceTitle, labels.noDeviceHint],
    busy: [labels.busyTitle, labels.busyHint],
    generic: [labels.errorTitle, labels.errorHint],
  };
  const [blockTitle, blockHint] =
    status === "denied" ? [labels.deniedTitle, labels.deniedHint] : problemText[problem];
  /** Asking again can help with these; never with an insecure page or a browser
   *  that has no recording API. */
  const canRetry =
    status === "denied" ||
    (status === "error" && problem !== "insecure" && problem !== "unsupported");

  /* ---------------- shared pieces ---------------- */

  const micButton = (
    <button
      type="button"
      className={cx(styles.recordButton, styles.record, docked && styles.recordDocked)}
      onClick={status === "prep" ? endPrepNow : requestAndStart}
      disabled={status === "requesting"}
      aria-label={
        status === "requesting"
          ? labels.requesting
          : status === "prep"
            ? labels.skip
            : labels.start
      }
    >
      {status === "requesting" ? <Spinner size="md" label="" /> : <MicIcon />}
    </button>
  );

  const stopButton = (
    <button
      type="button"
      className={cx(styles.recordButton, styles.stop, docked && styles.recordDocked)}
      onClick={stopRecording}
      aria-label={labels.stop}
    >
      <StopGlyph />
    </button>
  );

  const progressBar = showProgress && (
    <div
      className={cx(styles.progressTrack, docked && styles.progressTrackDocked)}
      role="progressbar"
      aria-label={labels.recording}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progressPct)}
    >
      <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
    </div>
  );

  const playRow = (
    <div className={styles.playRow}>
      <button
        type="button"
        className={styles.playButton}
        onClick={togglePlay}
        aria-label={playing ? labels.pause : labels.play}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <Waveform mode="static" peaks={peaks} barCount={48} height={40} className={styles.wave} />
      <span className={styles.playTime} aria-hidden>
        {formatTime(playing ? playbackMs : durationMs)}
      </span>
    </div>
  );

  const audioEl = (
    <audio
      ref={audioElRef}
      src={audioUrl ?? undefined}
      preload="metadata"
      className={styles.audio}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => {
        setPlaying(false);
        setPlaybackMs(0);
      }}
      onTimeUpdate={(e) => setPlaybackMs(e.currentTarget.currentTime * 1000)}
    />
  );

  const reviewButtons = (
    <div className={cx(styles.reviewActions, docked && styles.reviewActionsDocked)}>
      <Button variant="secondary" size={docked ? "lg" : "md"} fullWidth onClick={resetToIdle}>
        {labels.reRecord}
      </Button>
      <Button variant="primary" size={docked ? "lg" : "md"} fullWidth onClick={handleAccept}>
        {labels.accept}
      </Button>
    </div>
  );

  const limitReadout = showProgress && (
    <span className={styles.limit}>
      {formatTime(elapsedMs)}
      <span className={styles.limitTotal}> / {formatTime(maxDurationMs)}</span>
    </span>
  );

  /* ---------------- docked: the bottom action bar ---------------- */

  const dock = (() => {
    if (!docked) return null;
    const asideSlot = <div className={styles.dockStart}>{dockAside}</div>;
    switch (status) {
      case "idle":
      case "requesting":
        return (
          <div className={styles.dockRow}>
            {asideSlot}
            <div className={styles.dockCenter}>
              {micButton}
              <span className={styles.dockCaption} aria-hidden>
                {status === "requesting" ? labels.requesting : labels.start}
              </span>
            </div>
            <div className={styles.dockEnd} />
          </div>
        );
      case "prep":
        return (
          <div className={styles.dockRow}>
            {asideSlot}
            <div className={styles.dockCenter}>
              {micButton}
              <span className={styles.dockCaption} aria-hidden>
                {labels.skip}
              </span>
            </div>
            <div className={styles.dockEnd}>
              <span className={styles.limit} aria-hidden>
                {formatTime(prepRemainingMs + 999)}
              </span>
            </div>
          </div>
        );
      case "recording":
        return (
          <>
            <div className={styles.dockStrip}>
              <FlowingWaveform analyser={analyser} height={44} className={styles.dockWave} />
              {progressBar}
            </div>
            <div className={styles.dockRow}>
              <div className={styles.dockStart}>
                {onCancel && (
                  <Button variant="ghost" onClick={cancelRecording}>
                    {labels.cancel}
                  </Button>
                )}
              </div>
              <div className={styles.dockCenter}>
                {stopButton}
                <span className={cx(styles.dockCaption, styles.stopLabel)} aria-hidden>
                  {labels.stop}
                </span>
              </div>
              <div className={styles.dockEnd}>{limitReadout || (
                <span className={styles.limit}>{formatTime(elapsedMs)}</span>
              )}</div>
            </div>
          </>
        );
      case "review":
        return (
          <>
            <div className={styles.dockStrip}>{playRow}</div>
            {reviewButtons}
          </>
        );
      default:
        // denied / error: the reason is in the stage above; here, the way on.
        if (!canRetry && !dockAside) return null;
        return (
          <div className={styles.dockRow}>
            {asideSlot}
            <div className={styles.dockCenter}>
              {canRetry && (
                <Button variant="primary" size="lg" onClick={requestAndStart}>
                  {labels.retry}
                </Button>
              )}
            </div>
            <div className={styles.dockEnd} />
          </div>
        );
    }
  })();

  return (
    <section
      className={cx(styles.root, className)}
      aria-label={labels.region}
      data-status={status}
      {...rest}
    >
      {/* Polite live region for transient state changes. */}
      <VisuallyHidden as="div" role="status" aria-live="polite">
        {liveMessage}
      </VisuallyHidden>

      {/* ---- idle / requesting ---- */}
      {(status === "idle" || status === "requesting") && (
        <div className={styles.stage}>
          <Mascot mood="idle" size={mascotSize} label="" />
          <Text variant="body" color="ink-soft" align="center">
            {labels.idleHint}
          </Text>
          {!docked && micButton}
        </div>
      )}

      {/* ---- prep countdown ---- */}
      {status === "prep" && (
        <div className={styles.stage}>
          <CountdownRing
            remainingMs={prepRemainingMs}
            totalMs={prepMs}
            size={Math.round(mascotSize * 1.05)}
          />
          <Text variant="title-s" align="center" weight="black">
            {labels.prepTitle}
          </Text>
          <Text variant="body-s" color="ink-soft" align="center">
            {labels.prepHint}
          </Text>
          {!docked && (
            <Button variant="secondary" onClick={endPrepNow}>
              {labels.skip} →
            </Button>
          )}
        </div>
      )}

      {/* ---- recording ---- */}
      {status === "recording" && (
        <div className={styles.stage}>
          <Mascot mood="listening" size={mascotSize} label="" />
          {/* Docked, the clock lives in the bar ("0:12 / 2:00") — not twice. */}
          {!docked && (
            <span className={styles.timer} aria-hidden>
              {formatTime(elapsedMs)}
            </span>
          )}
          <span className={styles.recIndicator}>
            <span className={styles.pulseDot} aria-hidden />
            <Text as="span" variant="body-s" color="danger" weight="bold">
              {labels.recording}
            </Text>
          </span>
          {!docked && (
            <>
              {/* Same flowing-thread visual as the AI Suhbat composer. */}
              <FlowingWaveform analyser={analyser} height={72} className={styles.wave} />
              {progressBar}
              <div className={styles.controls}>
                <div className={styles.stopWrap}>
                  {stopButton}
                  <Text as="span" variant="body-s" weight="bold" className={styles.stopLabel}>
                    {labels.stop}
                  </Text>
                </div>
                {onCancel && (
                  <Button variant="ghost" onClick={cancelRecording}>
                    {labels.cancel}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ---- review ---- */}
      {status === "review" && (
        <div className={styles.stage}>
          <Mascot mood="proud" size={Math.round(mascotSize * 0.75)} label="" />
          {docked ? (
            <Text variant="body" color="ink-soft" align="center">
              {labels.reviewReady}
            </Text>
          ) : (
            <>
              {playRow}
              {reviewButtons}
            </>
          )}
          {audioEl}
        </div>
      )}

      {/* ---- denied / error ---- */}
      {(status === "denied" || status === "error") && (
        <div className={styles.stage} role="alert">
          <Mascot mood="sleepy" size={mascotSize} label="" />
          <Text variant="title-s" align="center" weight="black">
            {blockTitle}
          </Text>
          <Text variant="body-s" color="ink-soft" align="center" className={styles.hint}>
            {blockHint}
          </Text>
          {!docked && canRetry && (
            <Button variant="secondary" onClick={requestAndStart}>
              {labels.retry}
            </Button>
          )}
        </div>
      )}

      {docked && dockTarget && dock && createPortal(dock, dockTarget)}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Local presentational bits (icons + the prep ring).                          */
/* -------------------------------------------------------------------------- */

function MicIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
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

/** A crisp, softly-rounded stop square — the professional stop glyph. */
function StopGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden>
      <rect x="6.5" y="6.5" width="17" height="17" rx="5.5" fill="var(--primary-on)" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path d="M8 5.5v13l11-6.5z" fill="var(--primary-on)" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <rect x="7" y="5" width="4" height="14" rx="1.4" fill="var(--primary-on)" />
      <rect x="13" y="5" width="4" height="14" rx="1.4" fill="var(--primary-on)" />
    </svg>
  );
}

interface CountdownRingProps {
  remainingMs: number;
  totalMs: number;
  size: number;
}

/** Prep countdown ring. stroke-dashoffset is legitimate dynamic geometry. */
function CountdownRing({ remainingMs, totalMs, size }: CountdownRingProps) {
  const R = 52;
  const CIRC = 2 * Math.PI * R;
  const frac = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  const seconds = Math.ceil(remainingMs / 1000);
  return (
    <div className={styles.ring} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 120 120" className={styles.ringSvg} aria-hidden>
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - frac)}
          className={styles.ringArc}
        />
      </svg>
      <span className={styles.ringNum} aria-hidden>
        {seconds}
      </span>
    </div>
  );
}
