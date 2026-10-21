import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "../utils/cx";
import { Waveform } from "../Waveform/Waveform";
import styles from "./AudioPlayer.module.css";

export interface AudioPlayerProps {
  /** The recording. Missing → the "unavailable" state straight away. */
  src?: string | null;
  /** Text for the unavailable state (e.g. "the recording has expired"). */
  unavailableLabel?: ReactNode;
  /** Accessible name for the whole player region, e.g. "Recorded answer". */
  label?: string;
  className?: string;
}

const RATES = [1, 0.75] as const;
const BARS = 56;

/** 75.4 → "1:15"; non-finite → "0:00". */
export function formatClock(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Bucket the first channel into `count` peak amplitudes, normalised to 0..1. */
export function peaksFrom(samples: Float32Array, count: number): number[] {
  const out = new Array<number>(count).fill(0);
  if (samples.length === 0) return out;
  const per = samples.length / count;
  let max = 0;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * per);
    const end = Math.min(samples.length, Math.floor((i + 1) * per));
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > peak) peak = v;
    }
    out[i] = peak;
    if (peak > max) max = peak;
  }
  return max > 0 ? out.map((v) => v / max) : out;
}

type AudioCtor = typeof AudioContext;

/**
 * Best-effort waveform: fetch + decode the clip. Fails quietly (no CORS on the
 * storage host, a codec the engine can't decode, no Web Audio) — the player then
 * shows a plain progress bar, which is just as usable.
 */
async function loadPeaks(src: string, signal: AbortSignal): Promise<{ peaks: number[]; duration: number } | null> {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor || typeof fetch !== "function") return null;
  try {
    const res = await fetch(src, { signal });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const ctx = new Ctor();
    try {
      const audio = await ctx.decodeAudioData(buf);
      return { peaks: peaksFrom(audio.getChannelData(0), BARS), duration: audio.duration };
    } finally {
      void ctx.close?.();
    }
  } catch {
    return null;
  }
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden focusable="false">
      <rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5v5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

/**
 * AudioPlayer — the one player for a recorded answer (replaces `<audio controls>`,
 * whose look and labels follow the browser, not the app).
 *
 *  - play/pause (44px), elapsed / total, and a 1× ⇄ 0.75× speed toggle (pitch is
 *    preserved by the browser) — slowing a native speaker down is a real study aid;
 *  - scrubbing is a native `<input type="range">` laid over the waveform, so arrow
 *    keys, Home/End and screen-reader "adjustable" gestures all work, with the
 *    position announced as "0:12 / 0:45";
 *  - the waveform is decoded from the clip when the storage host allows it and
 *    falls back to a progress bar otherwise;
 *  - a load error (expired link, network) becomes a clear "recording unavailable"
 *    row with a retry, instead of a dead 0:00 control.
 *
 * MediaRecorder WebM files often report `duration = Infinity` until fully read;
 * the decoded length (or a seek-to-end probe) supplies the real total.
 */
export function AudioPlayer({ src, unavailableLabel, label, className }: AudioPlayerProps) {
  const { t, i18n } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const [failed, setFailed] = useState(false);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const probing = useRef(false);

  // Fresh source / retry → reset everything.
  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setFailed(false);
    setPeaks(null);
    if (!src) return;
    const ctl = new AbortController();
    void loadPeaks(src, ctl.signal).then((r) => {
      if (!r || ctl.signal.aborted) return;
      setPeaks(r.peaks);
      if (Number.isFinite(r.duration) && r.duration > 0) {
        setDuration((d) => (d > 0 ? d : r.duration));
      }
    });
    return () => ctl.abort();
  }, [src, attempt]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  const onMeta = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (Number.isFinite(a.duration) && a.duration > 0) {
      setDuration(a.duration);
      return;
    }
    // WebM without a duration header: seek far past the end; the browser then
    // learns the real length and fires durationchange.
    probing.current = true;
    try {
      a.currentTime = 1e7;
    } catch {
      probing.current = false;
    }
  }, []);

  const onDurationChange = useCallback(() => {
    const a = audioRef.current;
    if (!a || !Number.isFinite(a.duration) || a.duration <= 0) return;
    setDuration(a.duration);
    if (probing.current) {
      probing.current = false;
      a.currentTime = 0;
    }
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.playbackRate = rate;
      a.play().catch(() => {
        /* autoplay policy or decode error — onError handles the latter */
      });
    } else {
      a.pause();
    }
  };

  const seek = (value: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = value;
    setCurrent(value);
  };

  if (!src || failed) {
    return (
      <div className={cx(styles.unavailable, className)} role="status">
        <span className={styles.alert}>
          <AlertIcon />
        </span>
        <span className={styles.unavailableText}>
          {!src ? (unavailableLabel ?? t("audioPlayer.unavailable")) : t("audioPlayer.unavailable")}
          {src && <span className={styles.unavailableHint}>{t("audioPlayer.unavailableHint")}</span>}
        </span>
        {src && (
          <button type="button" className={styles.retry} onClick={() => setAttempt((n) => n + 1)}>
            {t("audioPlayer.retry")}
          </button>
        )}
      </div>
    );
  }

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const decimal = i18n.language?.startsWith("en") ? "." : ",";
  const rateText = rate === 1 ? "1×" : `0${decimal}75×`;
  const clock = `${formatClock(current)} / ${formatClock(duration)}`;

  return (
    <div
      className={cx(styles.root, className)}
      role="group"
      aria-label={label}
      style={{ "--progress": `${pct}%` } as CSSProperties}
    >
      <button
        type="button"
        className={styles.play}
        aria-label={playing ? t("audioPlayer.pause") : t("audioPlayer.play")}
        onClick={toggle}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div className={styles.track}>
        {peaks ? (
          <>
            <Waveform mode="static" peaks={peaks} barCount={BARS} height={36} className={styles.waveBase} />
            <div className={styles.wavePlayedClip} aria-hidden>
              <Waveform mode="static" peaks={peaks} barCount={BARS} height={36} className={styles.wavePlayed} />
            </div>
          </>
        ) : (
          <div className={styles.bar} aria-hidden>
            <div className={styles.barFill} />
          </div>
        )}
        <input
          type="range"
          className={styles.range}
          min={0}
          max={duration > 0 ? duration : 0}
          step="any"
          value={Math.min(current, duration || 0)}
          disabled={duration <= 0}
          aria-label={t("audioPlayer.seek")}
          aria-valuetext={clock}
          onChange={(e) => seek(Number(e.currentTarget.value))}
        />
      </div>

      <span className={styles.clock} aria-hidden>
        {clock}
      </span>

      <button
        type="button"
        className={styles.rate}
        aria-label={t("audioPlayer.speed", { rate: rateText })}

        onClick={() => setRate((r) => (r === 1 ? 0.75 : 1))}
      >
        {rateText}
      </button>

      <audio
        key={attempt}
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={onMeta}
        onDurationChange={onDurationChange}
        onTimeUpdate={(e) => {
          if (!probing.current) setCurrent(e.currentTarget.currentTime);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
          if (audioRef.current) audioRef.current.currentTime = 0;
        }}
        onError={() => {
          setPlaying(false);
          setFailed(true);
        }}
      />
    </div>
  );
}
