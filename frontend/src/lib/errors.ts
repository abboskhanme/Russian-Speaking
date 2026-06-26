// Maps an API error to a SAFE, user-friendly message. We never surface the raw
// backend `detail` (which can leak stack traces, AI quota messages, etc.) — for
// quota/server/upstream failures the user sees a calm "contact the admins" note.

type TFunc = (key: "serverError" | "genericError") => string;

interface ApiError {
  response?: { status?: number; data?: { detail?: string } };
}

/** A friendly message for an API error. `fallback` is shown for ordinary
 *  client-side errors (e.g. validation); 429/5xx always map to `serverError`. */
export function friendlyError(e: unknown, t: TFunc, fallback?: string): string {
  const status = (e as ApiError)?.response?.status ?? 0;
  if (status === 429 || status >= 500) return t("serverError");
  return fallback ?? t("genericError");
}
