import type { CSSProperties, HTMLAttributes } from "react";
import { cx } from "../utils/cx";
import styles from "./Mascot.module.css";

/**
 * The five (and only five) Govo moods — docs/03 §3.2, docs/04 §4.6.
 * Never a sad / crying / mocking mood: Govo is always kind.
 */
export type MascotMood = "idle" | "listening" | "thinking" | "proud" | "sleepy";

/** Style object that also permits the mascot's `--govo-*` CSS custom props. */
type MascotStyle = CSSProperties & Record<`--${string}`, string>;

export interface MascotProps extends HTMLAttributes<HTMLSpanElement> {
  /** One of the five moods. Prop-driven; the component owns no state. */
  mood?: MascotMood;
  /** Rendered box size in px (square). Min useful ~20px (logo), spec base 96. */
  size?: number;
  /**
   * Override the body colour. Defaults to the brand token `--primary`.
   * Pass any CSS colour; Govo's facial ink / eyes stay theme-independent so it
   * always reads on a saturated body (docs/03 §3.2).
   */
  color?: string;
  /**
   * Accessible label. Announced via `role="img"`. Pass an empty string when
   * Govo is decorative (e.g. inside the Recorder, whose status text already
   * describes the state) — the SVG is then hidden from assistive tech.
   */
  label?: string;
}

/**
 * Mascot — **Govo** (docs/03 §3.2). A speech-bubble creature built from three
 * primitives (squircle body, circle eyes, capsule bars). No mouth of its own:
 * when it "speaks" (`listening`) the mouth becomes a live waveform — the core
 * idea that fuses mascot and product into one interaction.
 *
 * Purely prop-driven (`mood` + `size` + optional `color`); no state coupling.
 * SVG-based, animated with token easing, and fully still under
 * `prefers-reduced-motion` (handled in the CSS module).
 */
export function Mascot({
  mood = "idle",
  size = 96,
  color,
  label = "Govo",
  className,
  style,
  ...rest
}: MascotProps) {
  const decorative = label.length === 0;

  const normalEyes =
    mood === "idle" || mood === "listening" || mood === "thinking";
  const thinking = mood === "thinking";
  const pupilY = thinking ? 48 : 53;
  const glintY = thinking ? 45 : 50;

  const mergedStyle: MascotStyle | undefined = color
    ? ({ ...(style as MascotStyle), "--govo-body": color })
    : (style as MascotStyle | undefined);

  return (
    <span
      className={cx(styles.root, className)}
      style={mergedStyle}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      {...rest}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 104"
        className={styles.svg}
        focusable="false"
        aria-hidden
      >
        <g className={styles.breathe}>
          {/* antenna */}
          <g className={styles.antenna}>
            <line
              x1="50"
              y1="30"
              x2="50"
              y2="12"
              className={styles.antennaStalk}
            />
            <circle cx="50" cy="9" r="4.6" className={styles.antennaCap} />
          </g>

          {/* feet */}
          <ellipse cx="38" cy="93" rx="8" ry="5" className={styles.foot} />
          <ellipse cx="62" cy="93" rx="8" ry="5" className={styles.foot} />

          {/* body */}
          <rect
            x="14"
            y="28"
            width="72"
            height="64"
            rx="30"
            className={styles.body}
          />

          {/* cheeks */}
          <circle cx="28" cy="64" r="6" className={styles.cheek} />
          <circle cx="72" cy="64" r="6" className={styles.cheek} />

          {/* eyes — normal (idle / listening / thinking) */}
          {normalEyes && (
            <g>
              <ellipse
                cx="38"
                cy="52"
                rx="8.5"
                ry="10.5"
                className={styles.eyeWhite}
              />
              <ellipse
                cx="62"
                cy="52"
                rx="8.5"
                ry="10.5"
                className={styles.eyeWhite}
              />
              <circle cx="39.5" cy={pupilY} r="4.3" className={styles.pupil} />
              <circle cx="63.5" cy={pupilY} r="4.3" className={styles.pupil} />
              <circle cx="41" cy={glintY} r="1.5" className={styles.glint} />
              <circle cx="65" cy={glintY} r="1.5" className={styles.glint} />
            </g>
          )}

          {/* eyes — proud (happy arcs ^^) */}
          {mood === "proud" && (
            <g className={styles.eyeStroke}>
              <path d="M30 55 Q38 46 46 55" />
              <path d="M54 55 Q62 46 70 55" />
            </g>
          )}

          {/* eyes — sleepy (half-closed) */}
          {mood === "sleepy" && (
            <g className={styles.eyeStroke}>
              <path d="M31 54 Q38 58 45 54" />
              <path d="M55 54 Q62 58 69 54" />
            </g>
          )}

          {/* mouth — idle smile */}
          {mood === "idle" && (
            <path d="M41 70 Q50 79 59 70" className={styles.mouth} />
          )}

          {/* mouth — proud big smile */}
          {mood === "proud" && (
            <path d="M39 69 Q50 82 61 69 Z" className={styles.mouthFill} />
          )}

          {/* mouth — listening: the live waveform */}
          {mood === "listening" && (
            <g className={styles.waveMouth}>
              <rect x="35" y="66" width="4.6" height="14" rx="2.3" />
              <rect x="43" y="66" width="4.6" height="14" rx="2.3" />
              <rect x="51" y="66" width="4.6" height="14" rx="2.3" />
              <rect x="59" y="66" width="4.6" height="14" rx="2.3" />
            </g>
          )}

          {/* mouth — thinking: small "o" + three rising dots from the antenna */}
          {thinking && (
            <>
              <ellipse cx="50" cy="72" rx="4" ry="4.5" className={styles.mouthFill} />
              <g className={styles.dots}>
                <circle cx="90" cy="40" r="3" />
                <circle cx="96" cy="33" r="2.4" />
                <circle cx="100" cy="27" r="1.8" />
              </g>
            </>
          )}

          {/* mouth — sleepy */}
          {mood === "sleepy" && (
            <path d="M45 72 Q50 75 55 72" className={styles.mouthSleepy} />
          )}
        </g>
      </svg>
    </span>
  );
}
