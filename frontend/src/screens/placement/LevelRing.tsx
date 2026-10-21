import { Text } from "../../shared/ui";
import styles from "./PlacementScreen.module.css";

export interface LevelRingProps {
  /** CEFR level shown large in the ring centre (e.g. "A2"). */
  level: string;
  /** Short caption under the level, already in the UI language (see `cefrLabel`). */
  label: string;
  /** 0–100 band that drives how far the ring sweeps. */
  band: number;
}

const R = 52;
const CIRC = 2 * Math.PI * R;

/**
 * LevelRing — the placement result ring (mockup frame A3): a progress ring whose sweep reflects the
 * averaged band, with the CEFR level + its caption stacked in the centre. Tokens only (no hardcoded
 * colours); the sweep is legitimate dynamic geometry via stroke-dashoffset.
 */
export function LevelRing({ level, label, band }: LevelRingProps) {
  const frac = Math.max(0, Math.min(1, band / 100));
  return (
    <div className={styles.ring} role="img" aria-label={`${level} · ${label}`}>
      <svg width="136" height="136" viewBox="0 0 120 120" className={styles.ringSvg} aria-hidden>
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="11" />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - frac)}
        />
      </svg>
      <div className={styles.ringCenter} aria-hidden>
        <Text as="span" variant="display" weight="black" className={styles.ringLevel}>
          {level}
        </Text>
        <Text as="span" variant="body-s" color="muted">
          {label}
        </Text>
      </div>
    </div>
  );
}
