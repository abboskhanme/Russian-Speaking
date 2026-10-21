import { useEffect, useState } from "react";

/** True when the user asked the OS for less motion. Safe where matchMedia is
 * missing (tests, very old browsers): it then reports "reduce", so nothing
 * animates that nobody can see anyway. */
export function prefersReducedMotion(): boolean {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

/**
 * useCountUp — counts 0 → `target` over `durationMs` with an ease-out curve
 * (the `--dur-countup` score reveal, docs/03 §3.5). Under reduced motion, or
 * with a null target, it returns the target immediately.
 */
export function useCountUp(target: number | null, durationMs = 900): number | null {
  const [value, setValue] = useState<number | null>(() =>
    target === null || prefersReducedMotion() ? target : 0,
  );
  useEffect(() => {
    if (target === null || prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}
