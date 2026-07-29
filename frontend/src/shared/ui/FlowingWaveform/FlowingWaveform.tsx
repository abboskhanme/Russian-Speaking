import { useEffect, useRef } from "react";
import type { HTMLAttributes } from "react";
import { cx } from "../utils/cx";
import { VisuallyHidden } from "../VisuallyHidden/VisuallyHidden";
import styles from "./FlowingWaveform.module.css";

export interface FlowingWaveformProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Live source. Owned by the caller (e.g. the recorder); null → a calm idle flow. */
  analyser?: AnalyserNode | null;
  /** Height of the band in CSS px. */
  height?: number;
  /** Number of overlapping thread lines. More = silkier + heavier. */
  lines?: number;
  /**
   * Screen-reader label. Empty string (default) marks it decorative — its
   * meaning is carried by the recorder's status text, not the visual.
   */
  label?: string;
}

/** Warm→cool gradient anchored on the brand orange (the app-adapted palette). */
const STOPS: Array<[number, string]> = [
  [0, "#f97316"], // brand orange
  [0.34, "#ef476f"], // rose
  [0.62, "#8b5cf6"], // violet
  [1, "#38bdf8"], // sky
];

/** Smooth, flowing envelope in -1..1 — layered sines at different wavelengths. */
function wave(u: number, t: number): number {
  const TAU = Math.PI * 2;
  const v =
    Math.sin(u * TAU * 1.5 + t * 1.1) +
    0.6 * Math.sin(u * TAU * 2.3 - t * 0.7 + 1.0) +
    0.35 * Math.sin(u * TAU * 3.7 + t * 1.6);
  return v / 1.95;
}

/** True when the app is in its dark theme (data-theme wins over the OS media). */
function isDarkTheme(): boolean {
  if (typeof document === "undefined") return false;
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/**
 * FlowingWaveform — the voice-recording visual (docs/03 §3.6): a bundle of thin
 * threads that share one flowing wave but at scaled amplitudes, so they fan apart
 * on loud sound and converge to a line on quiet — the silky, layered look of the
 * reference. The mic's loudness (analyser RMS) drives the fan height; the pattern
 * drifts over time. Drawn on a `<canvas>` DIRECTLY on the app surface (no dark
 * band): dark theme brightens overlaps (`screen` → a luminous core); light theme
 * composites normally so threads deepen toward their colour, never toward a muddy
 * bar. Either way the colour reads on the app ground. The palette is a
 * warm→cool gradient anchored on `--primary`; amplitudes are the legitimate
 * dynamic-geometry exception. Every browser API is feature-detected (SSR / type-
 * safe); honours `prefers-reduced-motion` by rendering one calm frame.
 */
export function FlowingWaveform({
  analyser = null,
  height = 132,
  lines = 60,
  label = "",
  className,
  style,
  ...rest
}: FlowingWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  // Smoothed loudness so the fan swells and settles instead of jittering.
  const levelRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === "undefined") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cssW = 0;
    let cssH = 0;
    const dpr = window.devicePixelRatio || 1;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const syncSize = () => {
      const rect = canvas.getBoundingClientRect();
      cssW = Math.max(1, Math.round(rect.width));
      cssH = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const timeBuf = analyser ? new Uint8Array(analyser.fftSize) : null;

    /** Current mic loudness 0..1 (RMS), or a gentle breath when there's no mic. */
    const readLevel = (t: number): number => {
      if (analyser && timeBuf) {
        analyser.getByteTimeDomainData(timeBuf);
        let sum = 0;
        for (let i = 0; i < timeBuf.length; i++) {
          const v = (timeBuf[i] - 128) / 128;
          sum += v * v;
        }
        return Math.min(1, Math.sqrt(sum / timeBuf.length) * 3.2);
      }
      return 0.18 + 0.12 * (0.5 + 0.5 * Math.sin(t * 0.9));
    };

    const gradientFor = (): CanvasGradient => {
      const g = ctx.createLinearGradient(0, 0, cssW, 0);
      for (const [at, color] of STOPS) g.addColorStop(at, color);
      return g;
    };

    const paint = (t: number) => {
      const target = readLevel(t);
      // Attack fast, release slow — a natural swell.
      const k = target > levelRef.current ? 0.35 : 0.08;
      levelRef.current += (target - levelRef.current) * k;
      const level = levelRef.current;

      ctx.clearRect(0, 0, cssW, cssH);
      // Dark theme brightens overlaps (screen → a luminous core); light theme
      // uses normal compositing so threads build toward their COLOUR, never
      // toward black — no muddy bar where the centre threads converge.
      const dark = isDarkTheme();
      ctx.globalCompositeOperation = dark ? "screen" : "source-over";
      ctx.lineWidth = 1.15;
      ctx.strokeStyle = gradientFor();

      const midY = cssH / 2;
      const amp = (cssH / 2) * (0.14 + 0.8 * level); // fan half-height
      const steps = Math.max(24, Math.round(cssW / 6));
      const half = (lines - 1) / 2;
      const baseAlpha = dark ? 0.16 : 0.28;

      for (let l = 0; l < lines; l++) {
        // -1..1 across the bundle → amplitude scale for this thread.
        const f = (l - half) / half;
        const lineAmp = f * amp;
        // Fainter toward the edges of the bundle for a soft falloff.
        ctx.globalAlpha = baseAlpha * (1 - 0.5 * Math.abs(f));
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          const x = u * cssW;
          const y = midY + lineAmp * wave(u, t);
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };

    syncSize();

    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncSize) : null;
    ro?.observe(canvas);

    if (reduce) {
      paint(0.6);
    } else {
      const start = performance.now();
      const loop = (now: number) => {
        paint((now - start) / 1000);
        rafRef.current = window.requestAnimationFrame(loop);
      };
      rafRef.current = window.requestAnimationFrame(loop);
    }

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      ro?.disconnect();
    };
  }, [analyser, lines]);

  const decorative = label.length === 0;

  return (
    <div
      className={cx(styles.root, className)}
      style={{ height, ...style }}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      {...rest}
    >
      <canvas ref={canvasRef} className={styles.canvas} />
      {!decorative && <VisuallyHidden>{label}</VisuallyHidden>}
    </div>
  );
}
