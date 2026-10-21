import { useId } from "react";
import styles from "./Chart.module.css";

export interface SparklineProps {
  /** The series, oldest first. Nulls are gaps. */
  values: Array<number | null>;
  /** Accessible summary, e.g. "Last 14 days: 3, 0, 5 …". Required: a sparkline
   * with no words is decoration a screen reader cannot read. */
  label: string;
  /** Optional per-point hover titles (same length as values). */
  titles?: string[];
}

/**
 * Sparkline — a 2px single-series trend line in the brand series colour (one
 * hue for every single-series chart in the panels; see Chart.module.css).
 *
 * Drawn in a fixed viewBox stretched to the tile with `preserveAspectRatio="none"`
 * — so the stroke is `vector-effect: non-scaling-stroke` and there are NO circle
 * markers (a non-uniform scale turns a dot into an ellipse, the bug the analytics
 * chart had). The last point is marked with an HTML dot positioned in %, which
 * stays round. A single point (or all-null) renders a flat baseline + that dot
 * rather than an empty box.
 */
export function Sparkline({ values, label, titles }: SparklineProps) {
  const clip = useId();
  const W = 100;
  const H = 32;
  const nums = values.filter((v): v is number => v != null);
  const max = Math.max(1, ...nums);
  const n = values.length;
  const x = (i: number) => (n <= 1 ? W : (i / (n - 1)) * W);
  const y = (v: number) => H - 2 - (v / max) * (H - 4);

  // Segments between nulls.
  const segs: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (cur.length) segs.push(cur.join(" "));
      cur = [];
    } else cur.push(`${cur.length ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  });
  if (cur.length) segs.push(cur.join(" "));

  let lastIdx = -1;
  for (let i = n - 1; i >= 0; i--) if (values[i] != null) { lastIdx = i; break; }
  const last = lastIdx >= 0 ? (values[lastIdx] as number) : null;

  return (
    <div className={styles.spark} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={styles.sparkSvg} aria-hidden>
        <defs>
          <clipPath id={clip}>
            <rect x="0" y="0" width={W} height={H} />
          </clipPath>
        </defs>
        <line x1="0" x2={W} y1={H - 2} y2={H - 2} className={styles.baseline} />
        <g clipPath={`url(#${clip})`}>
          {segs.map((d, i) => (
            <path key={i} d={d} className={styles.sparkLine} />
          ))}
        </g>
        {titles &&
          values.map((_, i) => (
            <rect
              key={i}
              x={n <= 1 ? 0 : x(i) - W / (2 * Math.max(1, n - 1))}
              width={n <= 1 ? W : W / Math.max(1, n - 1)}
              y="0"
              height={H}
              className={styles.hit}
            >
              <title>{titles[i]}</title>
            </rect>
          ))}
      </svg>
      {last != null && (
        <span
          className={styles.sparkDot}
          style={{ left: `${(x(lastIdx) / W) * 100}%`, top: `${(y(last) / H) * 100}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}
