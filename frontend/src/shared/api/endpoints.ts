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
  AdminCreateTeacherArgs,
  AdminRoleChangeArgs,
  AdminRoleChangeResponse,
  AdminStatsResponse,
  AdminStudentResponse,
  AdminStudentUpdateArgs,
  AdminTeacherResponse,
  AdminTeacherUpdateArgs,
  AiProbeResponse,
  AiSettingsResponse,
  AiSettingsUpdateArgs,
  AssignmentResponse,
  CreateAssignmentArgs,
  CreateModuleAssignmentArgs,
  AttemptDetailResponse,
  AuthConfigResponse,
  DailySessionResponse,
  DevUserResponse,
  DrillCatalogResponse,
  DrillResultResponse,
  GroupResponse,
  GroupDetailResponse,
  GradebookRowResponse,
  InsightsResponse,
  GroupJoinRequestResponse,
  TeacherBlockResponse,
  TeacherBlockDetailResponse,
  TeacherQuestionResponse,
  CreateBlockArgs,
  UpdateBlockArgs,
  CreateQuestionArgs,
  UpdateQuestionArgs,
  JoinGroupResponse,
  LeaderboardEntryResponse,
  LinksResponse,
  FeatureFlagsResponse,
  FeatureFlagsUpdateArgs,
  LinksUpdateArgs,
  RevealResponse,
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
  ReviewAnswerOutcome,
  ReviewAnswerResponse,
  ReviewDrillResponse,
  StudentModuleResponse,
  SubmissionResponse,
  TokenResponse,
  UnreadCountResponse,
  UpdateProfileArgs,
  AdminSubscriptionResponse,
  CheckoutArgs,
  CheckoutResponse,
  PlanResponse,
  PlanUpsertArgs,
  SubscriptionStatusResponse,
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

/**
 * End the session on the server as well as on this device.
 *
 * The refresh token is the whole payload and the whole point. An access token
 * expires on its own within thirty minutes; the refresh token behind it lives for
 * seven sliding days, so a logout that sends nothing leaves the session alive on
 * the server and "Chiqish" is a local gesture the backend never hears about.
 * `POST /auth/logout` takes an optional `{ refresh_token }` and revokes exactly
 * that one (Redis deny-list), which is what makes signing out on a shared phone
 * mean something.
 *
 * `keepalive` because this is the last call of a session: the caller signs out
 * locally and navigates immediately (waiting on the network to log out is a worse
 * product), and without it the browser is free to cancel the request as the page
 * changes — the token then survives precisely when the user most wanted it gone.
 * `fetch` + `keepalive` rather than `navigator.sendBeacon` because a beacon cannot
 * carry an `Authorization` header, cannot report a failure, and would be a second,
 * divergent way of talking to this API; the endpoint is unauthenticated today, but
 * a client that quietly stops working if it is ever tightened is not worth the
 * saving.
 *
 * The token is passed IN rather than read from the store here, because the caller
 * clears the store first — deliberately, so signing out is instant.
 */
export function logout(refreshToken?: string | null): Promise<void> {
  return apiClient.post<void>(
    "/auth/logout",
    // No token (already cleared, or never stored) still posts: the endpoint
    // answers 204 to a bodiless call, and a request with nothing to revoke is
    // better than a client that throws on the way out.
    refreshToken ? { refresh_token: refreshToken } : undefined,
    { keepalive: true, skipAuthRedirect: true },
  );
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

/* ── Auth — DEVELOPMENT-ONLY one-tap sign-in ──────────────────────────────
 *
 * These two call routes that DO NOT EXIST in production: the backend maps them
 * only when `IsDevelopment()`, so a production host answers 404 — not 403, and
 * not a route with a check inside it. See `DevLoginEndpoints` on the .NET side.
 *
 * The only caller is the panel in `LoginScreen`, and that whole block sits behind
 * `import.meta.env.DEV`, which Vite folds to `false` in a production build — so
 * these functions become unreferenced and are dropped from the bundle. That is
 * the SECOND, independent barrier: even if the routes somehow existed, the
 * shipped app would carry no code that knows their paths. `frontend/dist` is
 * grepped for exactly that.
 *
 * `auth: false` because the login page calls them before anyone is signed in, and
 * `skipAuthRedirect` so a refusal surfaces to the caller instead of bouncing the
 * browser to `/login` — which is where it already is.
 */

/** GET /api/auth/dev/users → the seeded demo accounts (one per role) that exist
 * in THIS database. **404 in production, and the panel must treat that as "do not
 * render".** */
export function devUsers(): Promise<DevUserResponse[]> {
  return apiClient.get<DevUserResponse[]>("/auth/dev/users", {
    auth: false,
    skipAuthRedirect: true,
  });
}

/** POST /api/auth/dev/login → a real token pair for one of the accounts
 * {@link devUsers} listed. The server accepts ONLY those ids: any other user id,
 * including a real one, is a `403`. */
export function devLogin(userId: string): Promise<TokenResponse> {
  return apiClient.post<TokenResponse>(
    "/auth/dev/login",
    { user_id: userId },
    { auth: false, skipAuthRedirect: true },
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

/** GET /api/reports/insights (?group_id) → the class analytics behind D1
 * «Insaytlar»: hero average + 3-month trend, the four KPIs, skill distribution,
 * this week's activity and the top error patterns. Teacher/admin; scoped
 * server-side to the caller's own roster and questions.
 *
 * Every aggregate can come back null — a teacher whose class has not been graded
 * yet gets nulls, not zeros, and the screen renders empty states rather than
 * inventing numbers. */
export function teacherInsights(groupId?: string): Promise<InsightsResponse> {
  const q = groupId ? `?group_id=${encodeURIComponent(groupId)}` : "";
  return apiClient.get<InsightsResponse>(`/reports/insights${q}`);
}

/* ── Settings ──────────────────────────────────────────────────────────── */

/** GET /api/settings/links → the deployment's Telegram support/channel URLs for
 * the "Yordam markazi" modal. Auth required (it rides the normal session). */
export function settingsLinks(): Promise<LinksResponse> {
  return apiClient.get<LinksResponse>("/settings/links");
}

/* ── Kunlik 5 daqiqa (docs/08 Faza 6.3, behind `daily_five_enabled`) ───────── */

/** GET /api/daily → today's session (warm-up → one task → one drill), stable for
 * the student's whole day. Auth required; the owner comes from the bearer token.
 *
 * `tz_offset` is minutes to ADD to UTC to reach the caller's local time, so the
 * day boundary is theirs and not the server's. It is derived here rather than
 * asked of every caller — `getTimezoneOffset()` returns minutes BEHIND UTC, and
 * flipping that sign once, at the edge, is how it stays flipped exactly once.
 *
 * Throws a 404 {@link ApiError} when the deployment has the flag OFF. That is the
 * feature's "not here" answer, not a failure — callers catch it and hide the
 * entry point rather than showing an error for something never switched on. */
export function dailySession(signal?: AbortSignal): Promise<DailySessionResponse> {
  const tzOffset = -new Date().getTimezoneOffset();
  return apiClient.get<DailySessionResponse>(`/daily?tz_offset=${tzOffset}`, { signal });
}

/* ── Xato-replay drill (docs/08 Faza 6.1, behind `review_drill_enabled`) ───── */

/** GET /api/review/drill → one drill session (due cards, capped server-side).
 * Auth required; the owner comes from the bearer token.
 *
 * Throws a 404 {@link ApiError} when the deployment has the drill flag OFF. That
 * is the feature's "not here" answer, not a failure — callers catch it and hide
 * the entry point rather than showing an error state for a feature that was
 * never turned on. */
export function reviewDrill(signal?: AbortSignal): Promise<ReviewDrillResponse> {
  return apiClient.get<ReviewDrillResponse>("/review/drill", { signal });
}

/** POST /api/review/{id}/answer → the item's new place on the SRS ladder.
 * `outcome` is the student's verdict on their own replay ("good" | "again").
 * Caller-scoped server-side, so another student's id is a 404 rather than a
 * cross-user write. */
export function answerReview(
  id: string,
  outcome: ReviewAnswerOutcome,
): Promise<ReviewAnswerResponse> {
  return apiClient.post<ReviewAnswerResponse>(
    `/review/${encodeURIComponent(id)}/answer`,
    { outcome },
  );
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

/** POST /api/assignments → assign ONE task (201). Targets are `student_ids` ∪ the
 * group's members, then filtered through the teacher's own roster server-side, so
 * the returned array is the authoritative count of what was actually created —
 * it can legitimately be shorter than the group's size. Report ITS length, never
 * the number you hoped for. */
export function createAssignments(args: CreateAssignmentArgs): Promise<AssignmentResponse[]> {
  return apiClient.post<AssignmentResponse[]>("/assignments", args);
}

/** POST /api/assignments/module → assign every PUBLISHED task of a module (201).
 * Tasks a student already has are skipped, so the result is usually smaller than
 * `task_count × students`; an empty module is a 400, not an empty success. */
export function createModuleAssignments(
  args: CreateModuleAssignmentArgs,
): Promise<AssignmentResponse[]> {
  return apiClient.post<AssignmentResponse[]>("/assignments/module", args);
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

/* ── Teacher — Kontent authoring (mockup board C) ─────────────────────────── */

/** GET /api/blocks → the teacher's OWN modules (403 for a student). */
export function teacherBlocks(): Promise<TeacherBlockResponse[]> {
  return apiClient.get<TeacherBlockResponse[]>("/blocks");
}

/** GET /api/blocks/{id} → module + ordered tasks. 404 when it is not yours. */
export function teacherBlock(id: string): Promise<TeacherBlockDetailResponse> {
  return apiClient.get<TeacherBlockDetailResponse>(`/blocks/${encodeURIComponent(id)}`);
}

/** POST /api/blocks → create a module (201). Starts as a DRAFT, so nothing
 * reaches students until it is published explicitly. */
export function createBlock(args: CreateBlockArgs): Promise<TeacherBlockDetailResponse> {
  return apiClient.post<TeacherBlockDetailResponse>("/blocks", args);
}

/** PATCH /api/blocks/{id} → partial update; omitted fields are left alone. */
export function updateBlock(
  id: string,
  args: UpdateBlockArgs,
): Promise<TeacherBlockDetailResponse> {
  return apiClient.patch<TeacherBlockDetailResponse>(`/blocks/${encodeURIComponent(id)}`, args);
}

/** GET /api/questions → the teacher's own tasks.
 * `search` matches title OR prompt; `unassignedOnly` is what C5's picker offers,
 * so a task can never be attached to two modules at once. */
export function teacherQuestions(opts?: {
  search?: string;
  blockId?: string;
  unassignedOnly?: boolean;
  limit?: number;
}): Promise<TeacherQuestionResponse[]> {
  const p = new URLSearchParams();
  if (opts?.search) p.set("q", opts.search);
  if (opts?.blockId) p.set("block_id", opts.blockId);
  if (opts?.unassignedOnly) p.set("unassigned", "true");
  p.set("limit", String(opts?.limit ?? 100));
  return apiClient.get<TeacherQuestionResponse[]>(`/questions?${p.toString()}`);
}

/** POST /api/questions → create a task (201). Starts as a DRAFT. */
export function createQuestion(args: CreateQuestionArgs): Promise<TeacherQuestionResponse> {
  return apiClient.post<TeacherQuestionResponse>("/questions", args);
}

/** POST /api/questions/{id}/media → set/replace the task's image or short video
 * (multipart, field "media"). Returns the updated task with a fresh presigned
 * `media_url`. 400 on a rejected type/size — the server's `detail` says which. */
export function setQuestionMedia(id: string, file: File): Promise<TeacherQuestionResponse> {
  const form = new FormData();
  form.append("media", file);
  // The browser sets the multipart boundary — we must NOT set Content-Type
  // (mirrors `uploadAvatar` / `submitAudio`).
  return apiClient.post<TeacherQuestionResponse>(
    `/questions/${encodeURIComponent(id)}/media`,
    form,
  );
}

/** DELETE /api/questions/{id}/media → clear it. Idempotent. */
export function removeQuestionMedia(id: string): Promise<TeacherQuestionResponse> {
  return apiClient.del<TeacherQuestionResponse>(`/questions/${encodeURIComponent(id)}/media`);
}

/** PATCH /api/questions/{id} → partial update, incl. attach/detach + reorder. */
export function updateQuestion(
  id: string,
  args: UpdateQuestionArgs,
): Promise<TeacherQuestionResponse> {
  return apiClient.patch<TeacherQuestionResponse>(`/questions/${encodeURIComponent(id)}`, args);
}

/* ── Administration ────────────────────────────────────────────────────────
 * Every route here is admin-gated server-side (the token's `sub` is looked up
 * and its role read from the DB). The client never decides who is an admin — it
 * only decides what to render. */

/** GET /api/admin/stats → the six dashboard counters. */
export function adminStats(): Promise<AdminStatsResponse> {
  return apiClient.get<AdminStatsResponse>("/admin/stats");
}

/** GET /api/admin/teachers (?search) → teachers with their authored-task counts. */
export function adminTeachers(search?: string): Promise<AdminTeacherResponse[]> {
  const q = search ? `?search=${encodeURIComponent(search)}` : "";
  return apiClient.get<AdminTeacherResponse[]>(`/admin/teachers${q}`);
}

/** POST /api/admin/teachers → 201 with the new row.
 *
 * The day-one path: on a fresh install nothing else can make a teacher. Refusals
 * carry a machine `code` (see {@link AdminErrorBody}): 409 `phone_taken_by_student`
 * (with `user_id` + `full_name`, so the UI can offer to promote that student
 * instead), 409 `phone_taken`, 400 `invalid_phone`. */
export function adminCreateTeacher(args: AdminCreateTeacherArgs): Promise<AdminTeacherResponse> {
  return apiClient.post<AdminTeacherResponse>("/admin/teachers", args);
}

/** PATCH /api/admin/users/{id}/role → `{ id, role }`.
 *
 * One endpoint for every direction (student ⇄ teacher, teacher ⇄ admin). Refusals:
 * 400 `cannot_change_own_role`, 409 `last_admin`, 409 `teacher_owns_groups` (with
 * `group_count`) — a teacher's groups would be left with no owner. */
export function adminChangeRole(
  id: string,
  role: AdminRoleChangeArgs["role"],
): Promise<AdminRoleChangeResponse> {
  return apiClient.patch<AdminRoleChangeResponse>(`/admin/users/${encodeURIComponent(id)}/role`, {
    role,
  } satisfies AdminRoleChangeArgs);
}

/** GET /api/admin/admins → every admin, the caller's own row marked `is_self`. */
export function adminAdmins(): Promise<AdminTeacherResponse[]> {
  return apiClient.get<AdminTeacherResponse[]>("/admin/admins");
}

/** PATCH /api/admin/teachers/{id} → rename / (de)activate. */
export function adminUpdateTeacher(
  id: string,
  args: AdminTeacherUpdateArgs,
): Promise<AdminTeacherResponse> {
  return apiClient.patch<AdminTeacherResponse>(`/admin/teachers/${encodeURIComponent(id)}`, args);
}

/** DELETE /api/admin/teachers/{id} → 204.
 *
 * **PERMANENT AND CASCADING.** The row is `Users.Remove`d, and the foreign keys
 * are ON DELETE CASCADE, so this also destroys that teacher's groups, modules,
 * tasks, topics and assignments. There is no undo and no soft-delete flag. The UI
 * must never offer this as a casual row action — deactivation is the reversible
 * answer to "make this account stop working". */
export function adminDeleteTeacher(id: string): Promise<void> {
  return apiClient.del<void>(`/admin/teachers/${encodeURIComponent(id)}`);
}

/** GET /api/admin/students (?search). */
export function adminStudents(search?: string): Promise<AdminStudentResponse[]> {
  const q = search ? `?search=${encodeURIComponent(search)}` : "";
  return apiClient.get<AdminStudentResponse[]>(`/admin/students${q}`);
}

/** PATCH /api/admin/students/{id} → rename, (de)activate, grant/revoke premium. */
export function adminUpdateStudent(
  id: string,
  args: AdminStudentUpdateArgs,
): Promise<AdminStudentResponse> {
  return apiClient.patch<AdminStudentResponse>(`/admin/students/${encodeURIComponent(id)}`, args);
}

/** DELETE /api/admin/students/{id} → 204.
 *
 * **PERMANENT AND CASCADING**, like the teacher one: it takes every answer,
 * evaluation, transcript, XP event, review item and group membership with it. */
export function adminDeleteStudent(id: string): Promise<void> {
  return apiClient.del<void>(`/admin/students/${encodeURIComponent(id)}`);
}

/** GET /api/admin/settings/ai → grader + STT settings with secrets MASKED. */
export function adminAiSettings(): Promise<AiSettingsResponse> {
  return apiClient.get<AiSettingsResponse>("/admin/settings/ai");
}

/** PATCH /api/admin/settings/ai → partial update (tri-state; see AiSettingsUpdateArgs). */
export function adminUpdateAiSettings(args: AiSettingsUpdateArgs): Promise<AiSettingsResponse> {
  return apiClient.patch<AiSettingsResponse>("/admin/settings/ai", args);
}

/** POST /api/admin/settings/ai/test → probe every backend the way the pipeline would.
 *
 * A POST, and not because it writes: it SPENDS. Each configured backend gets one real
 * minimal vendor call, so this is billable and must never be fired on render, on a
 * timer, or on a retry. Unconfigured backends come back `configured: false` and cost
 * nothing.
 *
 * Slow by nature — several seconds of live vendor latency, not a local check. */
export function adminTestAiSettings(): Promise<AiProbeResponse> {
  return apiClient.post<AiProbeResponse>("/admin/settings/ai/test");
}

/** GET /api/admin/settings/reveal/{key} → the RAW value of one secret. A deliberate,
 * explicit request: the masked state is what the settings screen shows by
 * default, and this is only called when an admin asks to see the value. */
export function adminRevealSecret(key: string): Promise<RevealResponse> {
  return apiClient.get<RevealResponse>(`/admin/settings/reveal/${encodeURIComponent(key)}`);
}

/** GET /api/admin/settings/features → the Faza 6 feature switches. */
export function adminFeatureFlags(): Promise<FeatureFlagsResponse> {
  return apiClient.get<FeatureFlagsResponse>("/admin/settings/features");
}

/** PATCH /api/admin/settings/features → tri-state update of the feature switches. */
export function adminUpdateFeatureFlags(
  args: FeatureFlagsUpdateArgs,
): Promise<FeatureFlagsResponse> {
  return apiClient.patch<FeatureFlagsResponse>("/admin/settings/features", args);
}

/** GET /api/admin/settings/links → the outbound Telegram links (admin view). */
export function adminLinks(): Promise<LinksResponse> {
  return apiClient.get<LinksResponse>("/admin/settings/links");
}

/** PATCH /api/admin/settings/links → tri-state update of the outbound links. */
export function adminUpdateLinks(args: LinksUpdateArgs): Promise<LinksResponse> {
  return apiClient.patch<LinksResponse>("/admin/settings/links", args);
}

/* ── F2 · Fonema drill / minimal juftliklar (docs/01 F2, behind
 *    `phoneme_drill_enabled`) ──────────────────────────────────────────────── */

/** GET /api/drills/pairs → the curated minimal pairs plus whether speaking is
 * possible right now. Auth required; the owner comes from the bearer token.
 *
 * Unlike the review drill this does NOT 404 when the flag is off — it answers
 * `state: "Disabled"` on a normal body. The difference is deliberate: this screen
 * has something true to say about each blocked state ("not enabled here", "no
 * speech key is wired", "you have used today's attempts"), and collapsing all
 * three into a 404 would send a person to the same dead end for three unrelated
 * reasons. */
export function drillPairs(signal?: AbortSignal): Promise<DrillCatalogResponse> {
  return apiClient.get<DrillCatalogResponse>("/drills/pairs", { signal });
}

/** POST /api/drills/attempts — one spoken word, judged against the pair.
 *
 * `targetWord` MUST be one of that pair's two twins; anything else is a 400.
 * That is a real constraint rather than defensive validation — the target
 * becomes the reference text sent to the vendor, and a caller free to choose it
 * could have the drill score against a word it has no phoneme spelling for.
 *
 * The response's `phonemes` array is DECORATION and is routinely empty; render
 * the verdict without it. See {@link DrillResultResponse}.
 *
 * Rate-limited server-side (`drill_attempt`), because every attempt costs a
 * vendor call — and two when the learner missed. */
export function submitDrillAttempt(
  pairSlug: string,
  targetWord: string,
  audio: Blob,
  durationSec?: number,
): Promise<DrillResultResponse> {
  const form = new FormData();
  form.append("pair_slug", pairSlug);
  form.append("target_word", targetWord);
  const ct = audio.type || "audio/webm";
  // Give the file a name + extension: the server's content-type sniff and the
  // transcoder both route on it (mirrors `submitAudio`).
  const ext = ct.includes("mp4") ? "mp4" : ct.includes("ogg") ? "ogg" : "webm";
  form.append("audio", audio, `drill.${ext}`);
  if (durationSec !== undefined) {
    form.append("audio_duration_sec", String(durationSec));
  }
  return apiClient.post<DrillResultResponse>("/drills/attempts", form);
}


/* ── Billing (docs/08 Faza 6.6) ──────────────────────────────────────────── */

/** GET /api/billing/plans → the tariffs on offer, cheapest-first by the admin's
 * order. Retired tariffs are absent: they still exist (old subscriptions point at
 * them) but are never sold again. */
export function billingPlans(): Promise<PlanResponse[]> {
  return apiClient.get<PlanResponse[]>("/billing/plans");
}

/** GET /api/billing/subscription → the caller's premium state, where it comes
 * from, and BOTH gate flags in one read.
 *
 * `is_premium` here is the same boolean the 402 paywall computes, so a screen
 * built on this can never promise access the gate will refuse. */
export function subscriptionStatus(): Promise<SubscriptionStatusResponse> {
  return apiClient.get<SubscriptionStatusResponse>("/billing/subscription");
}

/** POST /api/billing/checkout → start a purchase.
 *
 * **503 is the normal answer today**, not an error: `payments_disabled` (the flag
 * is off) or `provider_not_configured` (no merchant account yet). Callers render
 * that as a state — "to'lov tizimi hali ulanmagan" — and must never present it as
 * a failed payment, because nothing was attempted and nothing was charged.
 *
 * `idempotency_key` must be minted ONCE PER ATTEMPT and resent verbatim by any
 * retry; that is the only thing that makes the server's guard prevent a second
 * charge. Rate-limited server-side (`billing_checkout`). */
export function billingCheckout(args: CheckoutArgs): Promise<CheckoutResponse> {
  return apiClient.post<CheckoutResponse>("/billing/checkout", args);
}

/** GET /api/admin/billing/plans → every tariff, retired ones included. */
export function adminPlans(): Promise<PlanResponse[]> {
  return apiClient.get<PlanResponse[]>("/admin/billing/plans");
}

/** POST /api/admin/billing/plans → create a tariff. `price_minor` is TIYIN. */
export function adminCreatePlan(args: PlanUpsertArgs): Promise<PlanResponse> {
  return apiClient.post<PlanResponse>("/admin/billing/plans", args);
}

/** PATCH /api/admin/billing/plans/{id} → partial update; absent fields are left
 * alone. Editing a price does NOT change any subscription already sold: the end
 * date and the charged amount were frozen at purchase. */
export function adminUpdatePlan(id: string, args: PlanUpsertArgs): Promise<PlanResponse> {
  return apiClient.patch<PlanResponse>(`/admin/billing/plans/${encodeURIComponent(id)}`, args);
}

/** DELETE /api/admin/billing/plans/{id} → 204.
 *
 * REFUSED (400 `plan_in_use`) for a tariff any subscription or payment attempt
 * references — those rows say what a person bought and for how much, and a delete
 * would leave them unable to say it. Retiring a price is `is_active: false`. */
export function adminDeletePlan(id: string): Promise<void> {
  return apiClient.del<void>(`/admin/billing/plans/${encodeURIComponent(id)}`);
}

/** GET /api/admin/billing/subscriptions → who holds what, newest first.
 * Read-only: an admin grants premium through the student's `is_premium` switch,
 * which is deliberately a different, visible act from "this person paid". */
export function adminSubscriptions(limit?: number): Promise<AdminSubscriptionResponse[]> {
  const q = limit ? `?limit=${limit}` : "";
  return apiClient.get<AdminSubscriptionResponse[]>(`/admin/billing/subscriptions${q}`);
}
