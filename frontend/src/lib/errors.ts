// Maps an API error to a SAFE, user-friendly message. We never surface the raw
// backend `detail` (which can leak stack traces, AI quota messages, etc.) — for
// quota/server/upstream failures the user sees a calm "contact the admins" note.

type TFunc = (key: "serverError" | "busyError" | "genericError") => string;

interface ApiError {
  response?: { status?: number; data?: { detail?: string } };
}

/** A friendly message for an API error. `fallback` is shown for ordinary
 *  client-side errors (e.g. validation). A 429 (rate limit / service busy) gets
 *  its own calm "busy, try again shortly" note, distinct from 5xx which map to
 *  the "server problem, contact admin" `serverError`. Callers keep dedicated
 *  handling for 402 (paywall) and 403 (not assigned) BEFORE calling this. */
export function friendlyError(e: unknown, t: TFunc, fallback?: string): string {
  const status = (e as ApiError)?.response?.status ?? 0;
  if (status === 429) return t("busyError");
  if (status >= 500) return t("serverError");
  return fallback ?? t("genericError");
}
