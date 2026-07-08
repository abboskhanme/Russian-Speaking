import { useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { Button } from "./ui";

interface Props {
  maxSeconds: number;
  onComplete: (blob: Blob, durationSec: number) => void;
}

type Phase = "idle" | "recording" | "recorded";
const BARS = 70;

// iOS Safari throws on `new MediaRecorder(stream, { mimeType: "audio/webm" })`
// because it can't produce WebM. Pick the first container the browser actually
// supports; fall back to the browser default (no options) if none match.
function pickMimeType(): string | undefined {
  const candidates = ["audio/webm", "audio/mp4", "audio/ogg"];
  if (typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function") {
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
  }
  return undefined; // let the browser choose its default
}

/** Records mic audio (Opus/WebM) with a live waveform, volume meter, and a
 *  record → preview → send flow matching the product design. */
export function AudioRecorder({ maxSeconds, onComplete }: Props) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [staticBars, setStaticBars] = useState<number[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const barsRef = useRef<number[]>(new Array(BARS).fill(0.06));
  const frameRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const durationRef = useRef(0);
  const blobRef = useRef<Blob | null>(null);

  function cleanup() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    audioCtxRef.current?.close().catch(() => {});
    rafRef.current = null;
    timerRef.current = null;
  }

  useEffect(() => () => {
    cleanup();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!analyser || !canvas) {
      // Canvas mounts a frame after phase flips to "recording"; keep the loop alive.
      rafRef.current = requestAnimationFrame(draw);
      return;
    }
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    const amp = Math.min(1, rms * 4.5);

    // scroll the bar buffer (raw amplitude)
    const bars = barsRef.current;
    bars.push(amp);
    if (bars.length > BARS) bars.shift();
    frameRef.current += 1;
    const fr = frameRef.current;

    // render — long, centered, mirrored sound wave with a vertical gradient.
    // A gentle traveling idle wave keeps it visibly "alive" even when speaking softly.
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const w = canvas.width;
      const h = canvas.height;
      const mid = h / 2;
      ctx.clearRect(0, 0, w, h);

      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#9b7bff");
      grad.addColorStop(0.5, "#7c5cfc");
      grad.addColorStop(1, "#9b7bff");
      ctx.fillStyle = grad;

      const gap = 3;
      const bw = (w - gap * (BARS - 1)) / BARS;
      const r = Math.min(bw / 2, 3);
      for (let i = 0; i < bars.length; i++) {
        const idle = 0.13 + 0.07 * Math.sin(i * 0.5 + fr * 0.13) + 0.04 * Math.sin(i * 1.3 + fr * 0.07);
        const v = Math.max(bars[i], idle);
        const bh = Math.max(5, v * h * 0.9);
        const x = i * (bw + gap);
        const y = mid - bh / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, r);
        ctx.fill();
      }
    }
    rafRef.current = requestAnimationFrame(draw);
  }

  async function start() {
    setError(null);
    // Mic access (getUserMedia) only works in a secure context: HTTPS or
    // localhost. Over a LAN IP on plain HTTP the API is missing entirely and the
    // browser never even shows a permission prompt — explain that clearly.
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t(window.isSecureContext ? "micError" : "micInsecure"));
      return;
    }
    // No MediaRecorder at all (very old / restricted browser) → recording is
    // genuinely unsupported; that's distinct from a denied mic permission.
    if (typeof MediaRecorder === "undefined") {
      setError(t("micUnsupported"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      barsRef.current = new Array(BARS).fill(0.06);

      const mimeType = pickMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch {
        // Constructor can still throw on some engines even after isTypeSupported
        // checks — treat that as "recording not supported here".
        cleanup();
        setError(t("micUnsupported"));
        return;
      }
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onerror = () => {
        cleanup();
        setError(t("micError"));
        setPhase("idle");
      };
      recorder.onstop = () => {
        // Use the recorder's ACTUAL mime type (webm/mp4/ogg per browser) so the
        // blob and the eventual upload content-type match what was captured.
        const type = recorder.mimeType || mimeType || chunksRef.current[0]?.type || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        blobRef.current = blob;
        durationRef.current = (Date.now() - startedAtRef.current) / 1000;
        setStaticBars([...barsRef.current]);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setPhase("recorded");
        cleanup();
      };
      recorder.start();
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setPhase("recording");
      setElapsed(0);
      frameRef.current = 0;
      rafRef.current = requestAnimationFrame(draw);
      timerRef.current = window.setInterval(() => {
        setElapsed((s) => {
          const next = s + 1;
          if (next >= maxSeconds) stop();
          return next;
        });
      }, 1000);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setError(t(name === "NotAllowedError" ? "micDenied" : "micError"));
    }
  }

  function stop() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }

  function reset() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setStaticBars([]);
    blobRef.current = null;
    setElapsed(0);
    setPhase("idle");
  }

  function send() {
    if (blobRef.current) onComplete(blobRef.current, durationRef.current);
  }

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  /* ── idle ── */
  if (phase === "idle") {
    return (
      <div className="flex flex-col items-center gap-4 py-2">
        {error && <p className="text-[14px] font-bold text-danger">{error}</p>}
        <button
          onClick={start}
          className="animate-ring flex h-20 w-20 items-center justify-center rounded-full bg-brand text-white shadow-[0_12px_28px_-8px_rgba(124,92,252,0.8)] transition active:scale-95"
          aria-label={t("startSpeaking")}
        >
          <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="2.2">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
          </svg>
        </button>
        <p className="text-[15px] font-extrabold text-brand-deep">{t("startSpeaking")}</p>
      </div>
    );
  }

  /* ── recording ── */
  if (phase === "recording") {
    return (
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2 text-[15px] font-extrabold text-danger">
          <span className="animate-rec h-2.5 w-2.5 rounded-full bg-danger" />
          {t("recording")}
        </div>
        <div className="mt-2 font-mono text-[44px] font-extrabold leading-none tracking-tight text-ink tabular-nums">
          {fmt(elapsed)}
        </div>
        <p className="mt-1 text-[13px] font-semibold text-ios-secondary">{t("maxMinutes")}</p>

        <canvas ref={canvasRef} width={600} height={110} className="my-6 h-24 w-full" />

        <button
          onClick={stop}
          className="animate-ring flex h-18 w-18 items-center justify-center rounded-full bg-brand text-white shadow-[0_12px_28px_-8px_rgba(124,92,252,0.8)] transition active:scale-95"
          style={{ height: 72, width: 72 }}
          aria-label={t("stopRecording")}
        >
          <span className="h-6 w-6 rounded-[7px] bg-white" />
        </button>

        <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-4 py-2 text-[13px] font-bold text-brand-deep">
          ✨ {t("speakClearly")}
        </div>
      </div>
    );
  }

  /* ── recorded (preview) ── */
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-2xl bg-brand-tint px-4 py-3">
        <PlayButton url={audioUrl!} />
        <div className="flex h-12 flex-1 items-center gap-[3px] overflow-hidden">
          {staticBars.map((b, i) => (
            <span
              key={i}
              className="w-full max-w-[5px] flex-1 rounded-full bg-brand/70"
              style={{ height: `${Math.max(12, b * 100)}%` }}
            />
          ))}
        </div>
        <span className="font-mono text-[14px] font-bold text-ios-secondary tabular-nums">
          {fmt(Math.round(durationRef.current))}
        </span>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button variant="outline" className="flex-1 min-w-[150px]" onClick={reset}>
          🗑 {t("deleteRecording")}
        </Button>
        <Button variant="primary" className="flex-[1.4] min-w-[170px]" onClick={send}>
          {t("sendAnswer")} ➤
        </Button>
      </div>
    </div>
  );
}

/* ── small audio play/pause button ── */
function PlayButton({ url }: { url: string }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <>
      <audio ref={ref} src={url} onEnded={() => setPlaying(false)} className="hidden" />
      <button
        onClick={() => {
          const a = ref.current;
          if (!a) return;
          if (playing) {
            a.pause();
            setPlaying(false);
          } else {
            a.play();
            setPlaying(true);
          }
        }}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-[0_6px_14px_-4px_rgba(124,92,252,0.7)]"
        aria-label="play"
      >
        {playing ? (
          <span className="flex gap-1">
            <span className="h-4 w-[3px] rounded bg-white" />
            <span className="h-4 w-[3px] rounded bg-white" />
          </span>
        ) : (
          <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
    </>
  );
}
