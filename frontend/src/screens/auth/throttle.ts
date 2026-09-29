/**
 * throttle — the OTP endpoints' 429s, said with the number that matters: HOW LONG.
 *
 * The server refuses with 429 + `Retry-After` (seconds) in two situations that a
 * person needs told apart:
 *   • cooldown — a code was requested for this phone under a minute ago (this
 *     includes pressing "resend" too soon);
 *   • lockout  — ten wrong codes in the hour: even the RIGHT code is refused until
 *     the window passes, so typing it again only looks like the code is wrong.
 * Both used to fall through to "Xatolik yuz berdi", which reads as "try again" —
 * precisely the thing that cannot work yet. Sign-in, registration and the Profile's
 * phone change all share this, as they share `OtpStep`.
 */
import { useCallback, useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { isApiError } from "../../shared/api";

export type ThrottleKind = "cooldown" | "lockout";

export interface Throttle {
  kind: ThrottleKind;
  /** Epoch ms when the server will accept the request again. */
  until: number;
}

/**
 * A 429 WITH a `Retry-After` → the throttle to count down, else null (not a 429,
 * or a 429 that did not say how long — `otpErrorKey` words that one).
 */
export function throttleFrom(
  err: unknown,
  kind: ThrottleKind,
  now: number = Date.now(),
): Throttle | null {
  if (!isApiError(err) || err.status !== 429 || !err.retryAfterSec) return null;
  return { kind, until: now + err.retryAfterSec * 1000 };
}

/**
 * The shared status → message map for the OTP flows. Never the server's own
 * `detail`: it is English for some refusals ("Account is blocked") and Uzbek for
 * others, whatever language the screen is in.
 */
export function otpErrorKey(err: unknown): string {
  if (isApiError(err)) {
    if (err.status === 401) return "auth.errors.badCode";
    if (err.status === 400) return "auth.errors.badPhone";
    if (err.status === 403) return "auth.errors.blocked";
    if (err.status === 429) return "auth.errors.tooMany";
    if (err.status === 0) return "auth.errors.network";
  }
  return "auth.errors.generic";
}

/** The waiting line, from the seconds still left. */
export function throttleMessage(t: TFunction, throttle: Throttle, remainingSec: number): string {
  return throttle.kind === "lockout"
    ? t("auth.errors.lockout", { minutes: Math.max(1, Math.ceil(remainingSec / 60)) })
    : t("auth.errors.cooldown", { seconds: remainingSec });
}

/**
 * One running throttle and the whole seconds left on it, re-rendering once a
 * second while it lasts and clearing itself at zero — so the message and any
 * disabled button come back on their own, without the student having to guess.
 */
export function useThrottle(): {
  throttle: Throttle | null;
  remainingSec: number;
  start: (next: Throttle | null) => void;
} {
  const [throttle, setThrottle] = useState<Throttle | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!throttle) return;
    const id = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= throttle.until) setThrottle(null);
    }, 1000);
    return () => window.clearInterval(id);
  }, [throttle]);

  const start = useCallback((next: Throttle | null) => {
    setNow(Date.now());
    setThrottle(next);
  }, []);

  const remainingSec = throttle ? Math.max(0, Math.ceil((throttle.until - now) / 1000)) : 0;
  return { throttle: remainingSec > 0 ? throttle : null, remainingSec, start };
}
