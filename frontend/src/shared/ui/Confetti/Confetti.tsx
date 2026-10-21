import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../utils/motion";
import styles from "./Confetti.module.css";

/** Brand tokens the pieces are painted in — read at runtime, never hard-coded. */
const TOKENS = ["--primary", "--warn", "--success", "--accent", "--info"];

export interface ConfettiProps {
  /** Number of pieces. Kept small on purpose: a celebration, not a storm. */
  pieces?: number;
  /** Total run time in ms; the canvas removes itself when done. */
  durationMs?: number;
}

/**
 * Confetti — a light, dependency-free burst for a good score (~1.5 KB). One
 * canvas over the page, pointer-events off, hidden from assistive tech, and
 * NOTHING at all under `prefers-reduced-motion`. Colours come from the theme
 * tokens, so the burst matches light and dark alike.
 */
export function Confetti({ pieces = 70, durationMs = 1800 }: ConfettiProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || prefersReducedMotion()) return;
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const css = getComputedStyle(document.documentElement);
    const colors = TOKENS.map((t) => css.getPropertyValue(t).trim()).filter(Boolean);
    const originX = w / 2;
    const originY = Math.min(h * 0.3, 260);
    const parts = Array.from({ length: pieces }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      const speed = 6 + Math.random() * 7;
      return {
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 5,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: colors[Math.floor(Math.random() * colors.length)] || "currentColor",
      };
    });

    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const elapsed = now - start;
      const fade = Math.max(0, 1 - Math.max(0, elapsed - durationMs * 0.6) / (durationMs * 0.4));
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = fade;
      for (const p of parts) {
        p.vy += 0.28;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (elapsed < durationMs) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [pieces, durationMs]);

  return <canvas ref={ref} className={styles.canvas} aria-hidden />;
}

export default Confetti;
