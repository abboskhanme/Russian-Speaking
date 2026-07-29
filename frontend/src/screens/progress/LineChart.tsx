import { cx } from "../../shared/ui";
import styles from "./LineChart.module.css";

export interface LineChartProps {
  /** Y-values (the band per week), oldest → newest. 0, 1 or many all render. */
  points: number[];
  /** Accessible summary of the trend (the SVG itself is decorative). */
  ariaLabel: string;
  className?: string;
}

/* Chart geometry — a wide, short sparkline. `preserveAspectRatio="none"` lets it
 * stretch to the card width; the line keeps a crisp 2px via a non-scaling stroke,
 * so the horizontal stretch never fattens it. */
const W = 100;
const H = 40;
const PAD = 4;

interface Pt {
  x: number;
  y: number;
}

/** Map the raw values to chart coordinates (oldest→newest, left→right). A flat
 * series (or a single point) sits on the mid-line; a normal series is scaled to
 * fill the padded band between top and bottom. */
function toCoords(points: number[]): Pt[] {
  const n = points.length;
  if (n === 0) return [];

  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;

  const yFor = (v: number) =>
    span === 0 ? H / 2 : PAD + (1 - (v - min) / span) * innerH;

  // A single point becomes a flat line across the full width, so the card never
  // renders an empty box when there is exactly one week of history.
  if (n === 1) {
    const y = yFor(points[0]);
    return [
      { x: PAD, y },
      { x: W - PAD, y },
    ];
  }

  return points.map((v, i) => ({
    x: PAD + (i / (n - 1)) * innerW,
    y: yFor(v),
  }));
}

function toPath(coords: Pt[]): string {
  return coords
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
}

/**
 * LineChart — a dependency-free inline-SVG area/line sparkline of the band trend.
 *
 * Indigo (`--info`) stroke over a soft area fill, responsive (a `viewBox` +
 * `width: 100%`, stretched with `preserveAspectRatio="none"`). Purely decorative:
 * the `<svg>` is `aria-hidden` and the wrapper carries `role="img"` +
 * `aria-label`, so assistive tech hears one summary instead of a pile of nodes.
 * Handles 0 / 1 / n points without crashing — empty renders a dashed baseline.
 */
export function LineChart({ points, ariaLabel, className }: LineChartProps) {
  const coords = toCoords(points);
  const line = coords.length > 0 ? toPath(coords) : "";
  // Close the area down to the baseline and back to the start.
  const area =
    coords.length > 0
      ? `${line} L ${(W - PAD).toFixed(2)} ${H} L ${PAD.toFixed(2)} ${H} Z`
      : "";
  const last = coords[coords.length - 1];

  return (
    <div role="img" aria-label={ariaLabel} className={cx(styles.wrap, className)}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {coords.length === 0 ? (
          <line
            className={styles.baseline}
            x1={PAD}
            y1={H / 2}
            x2={W - PAD}
            y2={H / 2}
          />
        ) : (
          <>
            <path className={styles.area} d={area} />
            <path className={styles.line} d={line} />
            {last && <circle className={styles.dot} cx={last.x} cy={last.y} r={2.4} />}
          </>
        )}
      </svg>
    </div>
  );
}
