import styles from "./Chart.module.css";

export interface MiniBar {
  /** Axis label under the bar (e.g. "Du"). */
  label: string;
  value: number;
  /** Hover title, e.g. "Dushanba · 4 javob". */
  title?: string;
  /** Emphasise this bar (today). */
  current?: boolean;
}

export interface MiniBarsProps {
  bars: MiniBar[];
  /** Accessible summary of the whole chart. */
  label: string;
  /** Show the value above each non-zero bar (fine for ≤ 7 bars). */
  showValues?: boolean;
}

/**
 * MiniBars — a small single-series column chart (a week of activity). One hue:
 * the series colour, with "today" at full strength and the rest a step lighter;
 * zero days still draw a 2px stub so the axis reads as seven days, not a gap.
 * Bars have 4px rounded tops anchored to the baseline and a gap between them.
 * Each column is one hover target (a native title tooltip) taller than its mark.
 */
export function MiniBars({ bars, label, showValues = true }: MiniBarsProps) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <figure className={styles.bars} aria-label={label} role="img">
      <div className={styles.barsPlot} aria-hidden>
        {bars.map((b, i) => (
          <div key={i} className={styles.barCol} title={b.title}>
            {showValues && b.value > 0 && <span className={styles.barValue}>{b.value}</span>}
            <span
              className={b.current ? styles.barCurrent : styles.bar}
              style={{ height: b.value > 0 ? `${Math.max(6, (b.value / max) * 100)}%` : "2px" }}
            />
          </div>
        ))}
      </div>
      <div className={styles.barsAxis} aria-hidden>
        {bars.map((b, i) => (
          <span key={i} className={b.current ? styles.axisCurrent : styles.axisLabel}>
            {b.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
