import type { ReactNode } from "react";
import { cx } from "../../shared/ui";
import styles from "./ModuleCover.module.css";

export interface ModuleCoverProps {
  /** Stable id — picks the palette + motif, so a module keeps its cover. */
  id: string;
  /** The module's name — its first letter is the cover's centrepiece. */
  name: string;
  /** Larger hero variant (module detail). */
  size?: "md" | "lg";
  /** Locked/gated: the cover is shown quieter. */
  dimmed?: boolean;
  /** A corner badge (state). */
  children?: ReactNode;
  className?: string;
}

const TONES = ["toneA", "toneB", "toneC", "toneD", "toneE"] as const;

/** Small, stable string hash (FNV-1a) — same id, same cover, every visit. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * ModuleCover — an in-house illustrated cover for a module: a warm tinted tile,
 * one of four soft background motifs (speech bubbles, sound waves, dots, arcs)
 * and the module's initial letter set large in the display face. Deterministic
 * from the id; every colour is a theme token, so it reads in light and dark.
 * Purely decorative (aria-hidden) — the name is printed beside it.
 */
export function ModuleCover({ id, name, size = "md", dimmed = false, children, className }: ModuleCoverProps) {
  const h = hash(id);
  const tone = TONES[h % TONES.length];
  const motif = (h >>> 3) % 4;
  const initial = (name.trim().match(/\p{L}/u)?.[0] ?? "•").toUpperCase();

  return (
    <span
      className={cx(styles.cover, styles[tone], size === "lg" && styles.lg, dimmed && styles.dimmed, className)}
      aria-hidden
      data-testid="module-cover"
    >
      <svg className={styles.art} viewBox="0 0 64 64" preserveAspectRatio="xMidYMid slice">
        {motif === 0 && (
          <g className={styles.motif}>
            <rect x="34" y="6" width="26" height="18" rx="9" />
            <path d="M40 24l-3 6 8-6z" />
            <rect x="4" y="44" width="20" height="14" rx="7" />
          </g>
        )}
        {motif === 1 && (
          <g className={styles.motifStroke}>
            <path d="M2 50c6-8 10-8 16 0s10 8 16 0 10-8 16 0 10 8 14 2" />
            <path d="M2 14c6-6 10-6 16 0s10 6 16 0" />
          </g>
        )}
        {motif === 2 && (
          <g className={styles.motif}>
            <circle cx="52" cy="12" r="6" />
            <circle cx="10" cy="52" r="4" />
            <circle cx="56" cy="50" r="3" />
            <circle cx="8" cy="14" r="2.5" />
          </g>
        )}
        {motif === 3 && (
          <g className={styles.motifStroke}>
            <path d="M44 4a20 20 0 0 1 16 16" />
            <path d="M48 0a26 26 0 0 1 16 16" />
            <path d="M4 60a20 20 0 0 1 4-20" />
          </g>
        )}
      </svg>
      <span className={styles.initial}>{initial}</span>
      {children && <span className={styles.badge}>{children}</span>}
    </span>
  );
}
