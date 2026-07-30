/**
 * shared/api/endpoints — the typed function per API route the screens use.
 *
 * Each function is a one-liner over {@link apiClient}, so callers never build
 * paths or headers by hand. Auth calls (`login`, `register`, boot `me`) pass
 * `skipAuthRedirect` so a 401 surfaces to the form instead of bouncing to
 * `/login`. Paths are the .NET routes (`/api/...`, no `/v1`) confirmed against
 * the live API.
 */
import { apiClient } from "./client";
import type {
  AchievementResponse,
  AssignmentResponse,
  AttemptDetailResponse,
  AuthConfigResponse,
  GroupResponse,
  GroupDetailResponse,
  GradebookRowResponse,
  GroupJoinRequestResponse,
  JoinGroupResponse,
  LeaderboardEntryResponse,
  LinksResponse,
  MeResponse,
  NotificationResponse,
  OtpRequestResponse,
  OtpStatusResponse,
  OtpVerifyResponse,
  PhoneChangeRequestResponse,
  PlacementQuestionResponse,
  PlacementResultResponse,
  PlacementSubmitResponse,
  ProfileResultItemResponse,
  ProfileStatsResponse,
  ProgressLeaderboardResponse,
  ProgressSkillsResponse,
  StudentModuleResponse,
  SubmissionResponse,
  TokenResponse,
  UnreadCountResponse,
  UpdateProfileArgs,
} from "./types";

/* ── Auth (phone + Telegram-bot OTP) ─────────────────────────────────────── */

/** OTP step 1 — send a one-time code to the phone (via the Telegram bot, or a
 * dev hint). `400 {detail}` on a malformed phone. */
export function otpRequest(phone: string): Promise<OtpRequestResponse> {
  return apiClient.post<OtpRequestResponse>(
    "/auth/otp/request",
    { phone },
    { auth: false, skipAuthRedirect: true },
  );
}

/** OTP step 1b — poll how the Telegram delivery of a pending request is going
 * (`pending` → `awaiting_contact` → `sent`, or the burned `mismatch` /
 * `not_own_contact`). Anonymous like the request itself, and always 200: an
 * unknown/expired `requestId` answers `{ state: "expired" }`, never a 404.
 * Pass a `signal` so an unmounting poller can abort in flight. */
export function otpStatus(
  requestId: string,
  signal?: AbortSignal,
): Promise<OtpStatusResponse> {
  return apiClient.get<OtpStatusResponse>(
    `/auth/otp/status?request_id=${encodeURIComponent(requestId)}`,
    { auth: false, skipAuthRedirect: true, signal },
  );
}

/** OTP step 2 — exchange the code for a token pair. Pass `fullName` to register
 * a brand-new phone in one shot; omit it to log an existing phone in. A new
 * phone with no `fullName` returns `{ needs_registration: true }`. `401` on a
 * wrong/expired code, `403` when the account is blocked. */
export function otpVerify(
  phone: string,
  code: string,
  fullName?: string,
): Promise<OtpVerifyResponse> {
  const body: { phone: string; code: string; full_name?: string } = { phone, code };
  if (fullName && fullName.trim()) body.full_name = fullName.trim();
  return apiClient.post<OtpVerifyResponse>("/auth/otp/verify", body, {
    auth: false,
    skipAuthRedirect: true,
  });
}

export function refresh(refresh_token: string): Promise<TokenResponse> {
  return apiClient.post<TokenResponse>(
    "/auth/refresh",
    { refresh_token },
    { auth: false, skipAuthRedirect: true },
  );
}

export function logout(): Promise<void> {
  return apiClient.post<void>("/auth/logout");
}

/** Boot-time hydration + post-login user fetch. `skipRedirect` when hydrating. */
export function me(skipRedirect = false): Promise<MeResponse> {
  return apiClient.get<MeResponse>("/auth/me", { skipAuthRedirect: skipRedirect });
}

export function authConfig(): Promise<AuthConfigResponse> {
  return apiClient.get<AuthConfigResponse>("/auth/config", { auth: false });
}

/** PATCH /api/auth/me — partial profile update (registration "Manzil" step:
 * region / district / address). Auth required; returns the updated user. Only
 * the provided fields are written server-side. */
export function updateProfile(args: UpdateProfileArgs): Promise<MeResponse> {
  return apiClient.patch<MeResponse>("/auth/me", args);
}

/** POST /api/auth/me/avatar (multipart, field `avatar`) — set/replace the
 * caller's account photo. Returns the updated user (with a fresh `avatar_url`).
 * Auth required; validated server-side (type ∈ jpeg/png/webp, ≤ 5 MB) with a
 * distinct `400 {detail}` for wrong-type vs too-big. The browser sets the
 * multipart boundary — we must NOT set Content-Type (mirrors `submitAudio`). */
export function uploadAvatar(file: File): Promise<MeResponse> {
  const form = new FormData();
  form.append("avatar", file);
  return apiClient.post<MeResponse>("/auth/me/avatar", form);
}

/** DELETE /api/auth/me/avatar — clear the caller's account photo. Returns the
 * updated user (`avatar_url` now null). Auth required; idempotent (no avatar ⇒
 * still 200). */
export function removeAvatar(): Promise<MeResponse> {
  return apiClient.del<MeResponse>("/auth/me/avatar");
}

/** Phone change step 1 — mint an OTP for `newPhone` and bind the pending change
 * to the calling user. Auth required; the number travels in the BODY, never a
 * query string. `400` malformed phone, `409` the number already belongs to
 * another account (rejected before any code is sent, so a code is never leaked
 * to a number that can't be claimed). */
export function phoneChangeRequest(newPhone: string): Promise<PhoneChangeRequestResponse> {
  return apiClient.post<PhoneChangeRequestResponse>("/auth/phone/change/request", {
    new_phone: newPhone,
  });
}

/** Phone change step 2 — confirm the code and write the new number. Returns the
 * updated user; the user id is unchanged, so the session stays valid.
 *
 * `skipAuthRedirect` is REQUIRED here: this route answers `401` for a wrong or
 * expired CODE, which has nothing to do with the session. Without it the shared
 * 401 handler would bounce a signed-in user to `/login` for a typo. */
export function phoneChangeConfirm(code: string): Promise<MeResponse> {
  return apiClient.post<MeResponse>(
    "/auth/phone/change/confirm",
    { code },
    { skipAuthRedirect: true },
  );
}

/* ── Catalog — Home + Practice ─────────────────────────────────────────── */

export function studentBlocks(): Promise<StudentModuleResponse[]> {
  return apiClient.get<StudentModuleResponse[]>("/blocks/student");
}

/* ── Practice — submissions ────────────────────────────────────────────── */

export interface SubmitAudioArgs {
  questionId: string;
  audio: Blob;
  contentType?: string;
  durationSec?: number;
}

/** POST /api/submissions (multipart). → 201 SubmissionResponse (pending). */
export function submitAudio({
  questionId,
  audio,
  contentType,
  durationSec,
}: SubmitAudioArgs): Promise<SubmissionResponse> {
  const form = new FormData();
  form.append("question_id", questionId);
  const ct = contentType || audio.type || "audio/webm";
  // Give the file a name + type so the server's content-type sniff is happy.
  const ext = ct.includes("mp4") ? "mp4" : ct.includes("ogg") ? "ogg" : "webm";
  form.append("audio", audio, `answer.${ext}`);
  form.append("content_type", ct);
  if (durationSec !== undefined) form.append("audio_duration_sec", String(durationSec));
  return apiClient.post<SubmissionResponse>("/submissions", form);
}

export function getSubmission(id: string, signal?: AbortSignal): Promise<SubmissionResponse> {
  return apiClient.get<SubmissionResponse>(`/submissions/${id}`, { signal });
}

/** GET /api/submissions/{id}/detail → one attempt's full detail (audio + transcript
 * + AI score breakdown + feedback). Powers the result-detail screen. Auth required. */
export function attemptDetail(id: string, signal?: AbortSignal): Promise<AttemptDetailResponse> {
  return apiClient.get<AttemptDetailResponse>(`/submissions/${id}/detail`, { signal });
}

/* ── Placement — the one-time post-register CEFR check ───────────────────── */

/** GET /api/placement/questions → the 3 fixed Russian prompts (auth required). */
export function placementQuestions(): Promise<PlacementQuestionResponse[]> {
  return apiClient.get<PlacementQuestionResponse[]>("/placement/questions");
}

export interface PlacementSubmitArgs {
  index: number;
  audio: Blob;
}

/** POST /api/placement/submit (multipart: question_index + audio) → { index, band }. */
export function placementSubmit({ index, audio }: PlacementSubmitArgs): Promise<PlacementSubmitResponse> {
  const form = new FormData();
  form.append("question_index", String(index));
  const ct = audio.type || "audio/webm";
  const ext = ct.includes("mp4") ? "mp4" : ct.includes("ogg") ? "ogg" : "webm";
  form.append("audio", audio, `placement-${index}.${ext}`);
  return apiClient.post<PlacementSubmitResponse>("/placement/submit", form);
}

/** POST /api/placement/complete { bands } → the averaged CEFR level. */
export function placementComplete(bands: number[]): Promise<PlacementResultResponse> {
  return apiClient.post<PlacementResultResponse>("/placement/complete", { bands });
}

/* ── Guest placement — the SAME test, auth-less ("try before register") ──── */

/** GET /api/guest/placement/questions → the 3 fixed Russian prompts (NO auth —
 * a visitor can try the level test before signing up). Mirrors the authed one. */
export function guestPlacementQuestions(): Promise<PlacementQuestionResponse[]> {
  return apiClient.get<PlacementQuestionResponse[]>("/guest/placement/questions", { auth: false });
}

/** POST /api/guest/placement/submit (multipart) → { index, band }. No auth header. */
export function guestPlacementSubmit({ index, audio }: PlacementSubmitArgs): Promise<PlacementSubmitResponse> {
  const form = new FormData();
  form.append("question_index", String(index));
  const ct = audio.type || "audio/webm";
  const ext = ct.includes("mp4") ? "mp4" : ct.includes("ogg") ? "ogg" : "webm";
  form.append("audio", audio, `placement-${index}.${ext}`);
  return apiClient.post<PlacementSubmitResponse>("/guest/placement/submit", form, { auth: false });
}

/** POST /api/guest/placement/complete { bands } → the averaged CEFR level. No auth. */
export function guestPlacementComplete(bands: number[]): Promise<PlacementResultResponse> {
  return apiClient.post<PlacementResultResponse>("/guest/placement/complete", { bands }, { auth: false });
}

/* ── Engagement — Progress ─────────────────────────────────────────────── */

/** GET /api/leaderboard (?period, ?group_id). Param-free returns the all-time
 * global board; pass `groupId` for the caller's group board (its members ranked
 * — the "classmates" view). We read the current user's row (`is_me`) for their
 * real XP + streak. A group board is members-only on the server. */
export function leaderboard(
  period?: string,
  groupId?: string,
): Promise<LeaderboardEntryResponse[]> {
  const params = new URLSearchParams();
  if (period) params.set("period", period);
  if (groupId) params.set("group_id", groupId);
  const qs = params.toString();
  return apiClient.get<LeaderboardEntryResponse[]>(`/leaderboard${qs ? `?${qs}` : ""}`);
}

/* ── Progress — the redesigned Ko'nikmalar / Reyting tabs ─────────────────── */

/** GET /api/progress/skills → the caller's CEFR level, band trend and the four
 * sub-skill scores. Auth required; the student is taken from the bearer token.
 * The four skills always come back (0 when unscored) and the level is null until
 * a first attempt is graded. */
export function progressSkills(): Promise<ProgressSkillsResponse> {
  return apiClient.get<ProgressSkillsResponse>("/progress/skills");
}

/** GET /api/progress/leaderboard (?period=weekly|monthly|all — server default
 * weekly) → the caller's standing for the chosen period, with the neighbour
 * window centred on them. Auth required. The param is only sent when passed, so
 * the server default stays authoritative. */
export function progressLeaderboard(
  period?: string,
): Promise<ProgressLeaderboardResponse> {
  const qs = period ? `?period=${encodeURIComponent(period)}` : "";
  return apiClient.get<ProgressLeaderboardResponse>(`/progress/leaderboard${qs}`);
}

/* ── Profile ───────────────────────────────────────────────────────────── */

/** GET /api/profile/stats → the current user's four tiles. Auth required; the
 * user is taken from the bearer token, never from a path param. */
export function profileStats(): Promise<ProfileStatsResponse> {
  return apiClient.get<ProfileStatsResponse>("/profile/stats");
}

/** GET /api/profile/results (?limit=1..50, server default 10) → the most recent
 * GRADED attempts, newest first. Auth required. The query param is only sent
 * when a limit is passed, so the server default stays authoritative. */
export function profileResults(limit?: number): Promise<ProfileResultItemResponse[]> {
  const qs = limit === undefined ? "" : `?limit=${encodeURIComponent(String(limit))}`;
  return apiClient.get<ProfileResultItemResponse[]>(`/profile/results${qs}`);
}

/** GET /api/profile/achievements → the fixed 3-item catalogue scored against
 * the current user. Auth required; always returns all three, unlocked or not. */
export function profileAchievements(): Promise<AchievementResponse[]> {
  return apiClient.get<AchievementResponse[]>("/profile/achievements");
}

/* ── Classroom — groups ────────────────────────────────────────────────── */

/** GET /api/groups/mine → the current user's groups (auth required). Empty for
 * a student who joined none — the Profile group block then renders nothing. */
export function myGroups(): Promise<GroupResponse[]> {
  return apiClient.get<GroupResponse[]>("/groups/mine");
}

/** POST /api/groups/join → the caller REQUESTS to join a teacher's group by its
 * code. Auth required; 404 on an unknown/blank code.
 *
 * Joining does not grant membership: `pending: true` means the owning teacher
 * still has to approve. Only `pending: false` (the caller was already a member)
 * means they are in. Callers must branch on the flag — rendering "you're in the
 * group" off a pending response is the mistake it guards against. */
export function joinGroup(code: string): Promise<JoinGroupResponse> {
  return apiClient.post<JoinGroupResponse>("/groups/join", { code });
}

/** GET /api/groups/requests/mine → the caller's OWN pending join requests, so a
 * student who has asked sees "waiting for approval" instead of the join form. */
export function myJoinRequests(): Promise<GroupJoinRequestResponse[]> {
  return apiClient.get<GroupJoinRequestResponse[]>("/groups/requests/mine");
}

/** POST /api/groups/leave → the caller leaves their own group. Auth required;
 * the server only ever deletes the CALLER's membership, so there is no body.
 * 204 (resolves undefined) on success, `404` when the user is in no group. */
export function leaveGroup(): Promise<void> {
  return apiClient.post<void>("/groups/leave");
}

/** GET /api/assignments/mine → the caller's assignments (auth required). The Home
 * screen picks the soonest incomplete one for its "Keyingi topshiriq" line. */
export function assignmentsMine(): Promise<AssignmentResponse[]> {
  return apiClient.get<AssignmentResponse[]>("/assignments/mine");
}

/* ── Teacher — Boshqaruv paneli (docs/04 teacher flows, Faza 4.9) ─────────── */

/** GET /api/groups → the groups the caller OWNS + runs (teacher/admin; 403 for a
 * student). Distinct from {@link myGroups} (`/groups/mine`, the caller's own
 * memberships): this is the teacher-side list that powers the dashboard + the
 * Guruhlar screen. */
export function teacherGroups(): Promise<GroupResponse[]> {
  return apiClient.get<GroupResponse[]>("/groups");
}

/** GET /api/submissions (?limit=1..200, default 50) → the teacher's roster
 * attempts, newest first. The server scopes a teacher to their OWN questions AND
 * roster, so the list is empty for a teacher who has authored no questions.
 * Powers the dashboard's review-queue preview + the pending-review count
 * (attempts that are graded — `status === "done"` — but not yet teacher-reviewed,
 * `reviewed_at === null`). The dedicated review-queue filter arrives in Phase 5. */
export function teacherSubmissions(limit = 50): Promise<SubmissionResponse[]> {
  return apiClient.get<SubmissionResponse[]>(
    `/submissions?limit=${encodeURIComponent(String(limit))}`,
  );
}

/** GET /api/groups/{id} → one group + its roster (owner/admin; 404 otherwise, so
 * a group's existence never leaks). The Klasslar screen calls this per group to
 * build the flat "O'quvchilar" list — the roster is authoritative, unlike the
 * gradebook which omits students with no graded attempt. */
export function teacherGroupDetail(id: string): Promise<GroupDetailResponse> {
  return apiClient.get<GroupDetailResponse>(`/groups/${encodeURIComponent(id)}`);
}

/** POST /api/groups → create a group; the server mints the join code. 201. */
export function createGroup(name: string): Promise<GroupResponse> {
  return apiClient.post<GroupResponse>("/groups", { name });
}

/** GET /api/groups/requests → pending join requests across the caller's OWN
 * groups, oldest first (teacher/admin; 403 for a student). Backs the "So'rovlar"
 * tab. Server-scoped to owned groups — another teacher's requests are invisible. */
export function teacherJoinRequests(): Promise<GroupJoinRequestResponse[]> {
  return apiClient.get<GroupJoinRequestResponse[]>("/groups/requests");
}

/** POST /api/groups/requests/{id}/approve → admit the student (204). 404 when the
 * request is missing, already decided, or belongs to another teacher's group. */
export function approveJoinRequest(id: string): Promise<void> {
  return apiClient.post<void>(`/groups/requests/${encodeURIComponent(id)}/approve`);
}

/** POST /api/groups/requests/{id}/reject → decline (204). Same 404 rule. The
 * student may ask again later; rejection is not a permanent ban. */
export function rejectJoinRequest(id: string): Promise<void> {
  return apiClient.post<void>(`/groups/requests/${encodeURIComponent(id)}/reject`);
}

/** GET /api/reports/gradebook (?group_id) → one row per student the teacher may
 * see, with `avg_band` / `best_band` (0–100) + attempt counts. Teacher-scoped
 * server-side to their OWN questions AND roster, so a student with no attempt on
 * this teacher's questions has no row at all — callers must treat a missing row
 * as "not yet scored", not as "not a member". */
export function teacherGradebook(groupId?: string): Promise<GradebookRowResponse[]> {
  const q = groupId ? `?group_id=${encodeURIComponent(groupId)}` : "";
  return apiClient.get<GradebookRowResponse[]>(`/reports/gradebook${q}`);
}

/* ── Settings ──────────────────────────────────────────────────────────── */

/** GET /api/settings/links → the deployment's Telegram support/channel URLs for
 * the "Yordam markazi" modal. Auth required (it rides the normal session). */
export function settingsLinks(): Promise<LinksResponse> {
  return apiClient.get<LinksResponse>("/settings/links");
}

/* ── Notifications — the header bell + its centre ─────────────────────────── */

/** GET /api/notifications (?unread_only, ?limit — server default 50) → the
 * caller's notifications, newest first. Auth required; the owner comes from the
 * bearer token, never a param. Each query param is only sent when actually
 * passed, so the server's defaults stay authoritative. */
export function listNotifications(
  unreadOnly?: boolean,
  limit?: number,
): Promise<NotificationResponse[]> {
  const params = new URLSearchParams();
  if (unreadOnly !== undefined) params.set("unread_only", String(unreadOnly));
  if (limit !== undefined) params.set("limit", String(limit));
  const query = params.toString();
  return apiClient.get<NotificationResponse[]>(
    `/notifications${query ? `?${query}` : ""}`,
  );
}

/** GET /api/notifications/unread-count → `{ count }` for the bell badge. Auth
 * required. The bell polls this on mount and after every mutation. */
export function unreadCount(): Promise<UnreadCountResponse> {
  return apiClient.get<UnreadCountResponse>("/notifications/unread-count");
}

/** POST /api/notifications/read-all → marks every unread row read. Auth
 * required; no body. 204 (resolves undefined). */
export function markAllNotificationsRead(): Promise<void> {
  return apiClient.post<void>("/notifications/read-all");
}

/** POST /api/notifications/{id}/read → marks one row read. Auth required; the
 * server scopes the id to the caller, so someone else's id is a 404, not a
 * cross-user write. 204 (resolves undefined). */
export function markNotificationRead(id: string): Promise<void> {
  return apiClient.post<void>(`/notifications/${encodeURIComponent(id)}/read`);
}

/** DELETE /api/notifications/{id} → removes one row. Auth required and
 * caller-scoped like the read route. 204 (resolves undefined). There is no
 * bulk-delete-by-ids route: deleting a selection fires this per id. */
export function deleteNotification(id: string): Promise<void> {
  return apiClient.del<void>(`/notifications/${encodeURIComponent(id)}`);
}

/** DELETE /api/notifications → removes ALL of the caller's notifications, read
 * and unread. Auth required; irreversible, so the UI confirms first. 204. */
export function clearAllNotifications(): Promise<void> {
  return apiClient.del<void>("/notifications");
}

/** GET /api/assignments → the teacher's OWN assignments (admin: all). One row per
 * (student, question), so group-level views must fold them by question. */
export function teacherAssignments(): Promise<AssignmentResponse[]> {
  return apiClient.get<AssignmentResponse[]>("/assignments");
}

/** GET /api/submissions?student_id=… → one student's attempts, newest first.
 * The filter only NARROWS the caller's existing scope: a teacher asking for a
 * student outside their roster gets an empty list, never that student's work. */
export function teacherStudentSubmissions(
  studentId: string,
  limit = 50,
): Promise<SubmissionResponse[]> {
  return apiClient.get<SubmissionResponse[]>(
    `/submissions?student_id=${encodeURIComponent(studentId)}&limit=${encodeURIComponent(String(limit))}`,
  );
}

/* ── Teacher — Navbat (grading queue, mockup board B) ─────────────────────── */

/** GET /api/submissions?needs_review=true → the teacher's grading queue: AI
 * grading has FINISHED but no teacher has signed off. `failed` attempts are
 * excluded server-side — a pipeline failure is an ops problem, not a grading
 * decision. Teacher-scoped like every submission read. */
export function teacherReviewQueue(limit = 50): Promise<SubmissionResponse[]> {
  return apiClient.get<SubmissionResponse[]>(
    `/submissions?needs_review=true&limit=${encodeURIComponent(String(limit))}`,
  );
}

/** PATCH /api/submissions/{id}/review → write the teacher's verdict (204).
 *
 * Pass `band` to override the AI's score, `comment` for the "Izoh o'quvchiga",
 * or both. Sending NEITHER is a 400 — an empty review would still stamp
 * `reviewed_at` and drop the attempt out of the queue with no decision recorded.
 * A blank `comment` clears an existing note; omitting it leaves it untouched.
 * 404 when the attempt is outside this teacher's roster/questions. */
export function reviewSubmission(
  id: string,
  args: { band?: number; comment?: string },
): Promise<void> {
  const body: { teacher_band?: number; teacher_comment?: string } = {};
  if (args.band !== undefined) body.teacher_band = args.band;
  if (args.comment !== undefined) body.teacher_comment = args.comment;
  return apiClient.patch<void>(`/submissions/${encodeURIComponent(id)}/review`, body);
}
