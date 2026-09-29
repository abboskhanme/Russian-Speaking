/**
 * screens/admin/adminErrors — reading an Administration refusal.
 *
 * The API answers a refused write with its usual `{ detail }` plus a machine `code`
 * (and, for some codes, the facts the UI needs next — who owns the phone, how many
 * groups are in the way). `detail` is an English developer sentence and is never
 * shown: the admin panel is Uzbek-first, and a raw server string on a screen is how a
 * product stops sounding like one. So every branch keys on `code`, and anything
 * unrecognised falls back to a localized generic line.
 */
import type { TFunction } from "i18next";
import { isApiError } from "../../shared/api";
import type { AdminErrorBody } from "../../shared/api";

/** The parsed error body of a refused request, or null for anything that is not an
 * API error with a JSON body (a network failure, a thrown bug). */
export function adminErrorBody(e: unknown): AdminErrorBody | null {
  if (!isApiError(e)) return null;
  const body = e.body;
  return body !== null && typeof body === "object" ? (body as AdminErrorBody) : null;
}

/** The machine `code` of a refusal, or null. */
export function adminErrorCode(e: unknown): string | null {
  const code = adminErrorBody(e)?.code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/** True when the request never reached the server — worth its own sentence, because
 * "check your connection" and "the server said no" send an admin to different places. */
export function isNetworkError(e: unknown): boolean {
  return isApiError(e) && e.status === 0;
}

/**
 * The sentence for a refused role change (`PATCH /api/admin/users/{id}/role`).
 *
 * `teacher_owns_groups` carries the count, and the sentence names it: "this teacher
 * has groups" invites a hunt, "this teacher has 3 groups" is a task.
 */
export function roleChangeError(e: unknown, t: TFunction): string {
  const body = adminErrorBody(e);
  switch (body?.code) {
    case "last_admin":
      return t("admin.role.errLastAdmin");
    case "cannot_change_own_role":
      return t("admin.role.errOwnRole");
    case "teacher_owns_groups":
      return typeof body.group_count === "number"
        ? t("admin.role.errOwnsGroups", { count: body.group_count })
        : t("admin.role.errOwnsGroupsUnknown");
    case "invalid_role":
      // Only reachable through a client bug — the buttons send the three real roles.
      return t("admin.role.errInvalidRole");
  }
  if (isNetworkError(e)) return t("auth.errors.network");
  return t("admin.saveFailed");
}
