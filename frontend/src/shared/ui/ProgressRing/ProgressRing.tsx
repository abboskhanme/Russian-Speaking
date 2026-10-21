import type { ReactNode } from "react";
import { cx } from "../utils/cx";
import styles from "./ProgressRing.module.css";

export type ProgressRingTone = "primary" | "success" | "warn" | "danger" | "info";

export interface ProgressRingProps {
  /** 0..1 — clamped. */
  value: number;
  /** Box size in px (square). The SVG scales UNIFORMLY, so the ring stays round. */
  size?: number;
  /** Stroke width in px at `size`. */
  stroke?: number;
  tone?: ProgressRingTone;
  /** Accessible summary; the ring itself is decorative. Empty → hidden from AT. */
  label?: string;
  /** Centre content — laid out with flex centring on both axes. */
  children?: ReactNode;
  className?: string;
}

/**
 * ProgressRing — a round progress meter with a centred slot. The centre is a
 * flex box centred on BOTH axes (never `baseline`), so a "50%" or a check mark
 * sits in the optical middle of the ring. The arc animates with `--m-slow`,
 * which tokens.css collapses under `prefers-reduced-motion`.
 */
export function ProgressRing({
  value,
  size = 72,
  stroke = 7,
  tone = "primary",
  label,
  children,
  className,
}: ProgressRingProps) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const decorative = !label;
  return (
    <span
      className={cx(styles.root, className)}
      style={{ width: size, height: size }}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className={styles.svg}>
        <circle className={styles.track} cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className={cx(styles.arc, styles[tone])}
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          // A round cap would paint a lone dot at 0 — an empty ring must look empty.
          opacity={v === 0 ? 0 : 1}
          data-testid="ring-arc"
        />
      </svg>
      <span className={styles.center} aria-hidden>
        {children}
      </span>
    </span>
  );
}
