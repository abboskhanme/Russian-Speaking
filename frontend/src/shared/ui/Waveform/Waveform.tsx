import { useEffect, useRef } from "react";
import type { HTMLAttributes } from "react";
import { cx } from "../utils/cx";
import { VisuallyHidden } from "../VisuallyHidden/VisuallyHidden";
import styles from "./Waveform.module.css";

export type WaveformMode = "live" | "static";

export interface WaveformProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** `live` reads an `AnalyserNode` each frame; `static` renders `peaks` once. */
  mode: WaveformMode;
  /** Live source. Owned by the caller (e.g. Recorder); may be null while idle. */
  analyser?: AnalyserNode | null;
  /** Static amplitudes, each 0..1. Used when `mode="static"`. */
  peaks?: number[];
  /** Number of bars to draw. */
  barCount?: number;
  /** Height in CSS px. */
  height?: number;
  /**
   * Screen-reader label. Empty string (default) marks the waveform decorative —
   * its meaning is carried by the Recorder's status text, not the bars.
   */
  label?: string;
}

/** Smallest bar fraction so silence still reads as a row of dots, not a gap. */
const MIN_SCALE = 0.06;
/** Fraction of each slot left empty between bars. */
const GAP_RATIO = 0.42;

/** Average `data` into `count` buckets, returning values normalised to 0..1. */
function resample(data: Uint8Array | number[], count: number): number[] {
  const out = new Array<number>(count);
  const isBytes = data instanceof Uint8Array;
  const len = data.length;
  if (len === 0) return out.fill(0);
  const per = len / count;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * per);
    const end = Math.max(start + 1, Math.floor((i + 1) * per));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < len; j++) {
      sum += data[j];
      n++;
    }
    const avg = n > 0 ? sum / n : 0;
    out[i] = isBytes ? avg / 255 : avg;
  }
  return out;
}

function roundBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  // roundRect is not in every engine yet — fall back to a plain rect.
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rr);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
}

/**
 * Waveform — the voice bars (docs/03 §3.6). Two modes:
 *  - `live`   → animates an `AnalyserNode`'s frequency data via rAF (the mic).
 *  - `static` → renders a fixed `peaks` envelope (a recorded clip in review).
 *
 * Drawn on a `<canvas>`; the bar colour comes from the token `--primary`
 * (resolved through `getComputedStyle`, so it tracks light/dark), while bar
 * *heights* are the legitimate dynamic-geometry exception (docs/03 §3.10).
 * All browser APIs are feature-detected so the module is SSR / type-safe.
 */
export function Waveform({
  mode,
  analyser = null,
  peaks,
  barCount = 40,
  height = 48,
  label = "",
  className,
  style,
  ...rest
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === "undefined") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cssW = 0;
    let cssH = 0;
    const dpr = window.devicePixelRatio || 1;

    const syncSize = () => {
      const rect = canvas.getBoundingClientRect();
      cssW = Math.max(1, Math.round(rect.width));
      cssH = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const paint = (values: number[]) => {
      const color = getComputedStyle(canvas).color;
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = color;
      const n = values.length;
      if (n === 0) return;
      const slot = cssW / n;
      const barW = Math.max(2, slot * (1 - GAP_RATIO));
      const mid = cssH / 2;
      for (let i = 0; i < n; i++) {
        const v = Math.min(1, Math.max(MIN_SCALE, values[i] || 0));
        const h = Math.max(barW, v * cssH);
        const x = i * slot + (slot - barW) / 2;
        const y = mid - h / 2;
        roundBar(ctx, x, y, barW, h, barW / 2);
      }
    };

    syncSize();

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            syncSize();
            if (mode === "static") paint(resample(peaks ?? [], barCount));
          })
        : null;
    ro?.observe(canvas);

    if (mode === "live" && analyser) {
      const bins = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(bins);
        // Speech energy sits low-mid; sampling ~78% of the spectrum looks livelier.
        const usable = bins.subarray(0, Math.floor(bins.length * 0.78));
        paint(resample(usable, barCount));
        rafRef.current = window.requestAnimationFrame(loop);
      };
      loop();
    } else {
      paint(resample(peaks ?? [], barCount));
    }

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      ro?.disconnect();
    };
  }, [mode, analyser, peaks, barCount]);

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
