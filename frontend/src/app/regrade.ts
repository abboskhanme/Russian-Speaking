/**
 * Failed-grading retry — the one client-side rule for `POST /api/submissions/{id}/regrade`,
 * shared by the student's results list + detail, the teacher's attempt review and the admin
 * dashboard's failed-answers list.
 *
 * A regrade puts the SAME recording back through grading: it never records anything new and
 * never spends an extra attempt. The server decides whether it may happen (owner / roster
 * teacher / admin, attempt budget, freemium gate, AI budget) and says why not with a code;
 * this file turns that code into words and the success into the row's new state.
 */
import type { TFunction } from "i18next";
import { endpoints, isApiError } from "../shared/api";
import type { RegradeErrorCode, SubmissionResponse } from "../shared/api";

const CODES: readonly RegradeErrorCode[] = [
  "not_failed",
  "audio_expired",
  "attempts_exhausted",
  "payment_required",
  "ai_unavailable",
];

/** The refusal's `code`, when the server sent a known one. */
export function regradeErrorCode(e: unknown): RegradeErrorCode | null {
  if (!isApiError(e)) return null;
  const body = e.body as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : null;
  return code && (CODES as readonly string[]).includes(code) ? (code as RegradeErrorCode) : null;
}

/** A localized sentence for a failed regrade — never the server's English `detail`. */
export function regradeErrorText(t: TFunction, e: unknown): string {
  const code = regradeErrorCode(e);
  if (code) return t(`uiDash.regrade.error.${code}`);
  if (isApiError(e) && e.status === 429) return t("uiDash.regrade.error.rate_limited");
  return t("uiDash.regrade.error.generic");
}

/**
 * Ask for a regrade; on refusal throw an Error whose message is already localized, so a
 * control can show `e.message` as-is.
 */
export async function requestRegrade(t: TFunction, id: string): Promise<SubmissionResponse> {
  try {
    return await endpoints.regradeSubmission(id);
  } catch (e) {
    throw new Error(regradeErrorText(t, e));
  }
}

/** Whether a failed attempt is worth offering a retry for: the recording must still exist. */
export function canRegrade(status: string, audioExpired?: boolean): boolean {
  return status === "failed" && !audioExpired;
}
