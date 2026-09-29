/**
 * shared/api/types — TypeScript mirrors of the .NET DTOs
 * (backend-dotnet/src/Govori.Contracts/*.cs). Field names are the EXACT wire
 * shapes: snake_case, since the host serializes with
 * JsonNamingPolicy.SnakeCaseLower. These are the shapes the curl check against
 * the live API confirmed (login / me / blocks-student / leaderboard).
 */

/* ── Auth (AuthContracts.cs) ─────────────────────────────────────────────── */

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export type UserRole = "student" | "teacher" | "admin";

/** GET /api/auth/me → MeResponse. `email` is a `{phone}@govori.uz` placeholder
 * the backend synthesises from the phone; the phone + Telegram OTP flow never
 * shows it in the UI. */
export interface MeResponse {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  is_premium: boolean;
  /** Registration "Manzil" fields — null until the address step is completed. */
  region: string | null;
  district: string | null;
  address: string | null;
  /** The real phone the account was created with (`email` is only a synthesised
   * placeholder built from it). Null on legacy rows that predate phone auth. */
  phone: string | null;
  /** User.CreatedAt, ISO-8601 — the Profile "Ro'yxatdan o'tgan" row. */
  created_at: string;
  /** CEFR level DERIVED from the average Evaluation.OverallBand — there is no
   * stored level column. Null when the user has no graded attempt yet, and the
   * UI hides the badge rather than showing a placeholder. */
  level: string | null;
  /** The short Uzbek label paired with {@link level} (e.g. "boshlang'ich").
   * Comes from the backend already localised to Uzbek; null whenever `level`
   * is null. */
  level_label: string | null;
  /** APPEND-ONLY. Presigned-GET URL for the account photo, minted per request
   * from `User.AvatarKey` the same way a submission's `audio_url` is minted —
   * a short-lived download link, never a stored value. Null when the user has
   * no avatar, and the UI falls back to the name initials. Set/cleared via
   * `uploadAvatar` / `removeAvatar`. */
  avatar_url: string | null;
  /** Whether the user wants product notifications. A real column since the
   * Phase 7 profile work — the toggle used to be session-local and forgot the
   * choice on every reload. Defaults to `true` for every pre-existing account. */
  notifications_enabled: boolean;
  /** The account's UI language (`uz` · `ru` · `en`). The auth store adopts it
   * whenever identity resolves, so the choice follows the user to another device
   * instead of living only in each browser's localStorage. */
  preferred_language: string;
}

/** PATCH /api/auth/me body — partial profile update (the registration "Manzil"
 * step and the Profile "Ma'lumot" edit dialog). Tri-state: a field that is
 * absent (or null) is left untouched, so a caller only sends what it edits.
 *
 * `full_name` is APPEND-ONLY on the .NET `UpdateProfileRequest` and is the one
 * field the server refuses to blank — an empty display name would break the
 * avatar initials and every "Salom, {name}" string, so it is validated
 * (trimmed, non-empty) on both sides. */
export interface UpdateProfileArgs {
  region?: string | null;
  district?: string | null;
  address?: string | null;
  full_name?: string | null;
  /** The notification preference. Tri-state on purpose: omit it to leave the
   * stored value alone, send `false` to turn notifications OFF. Without the
   * nullability on the wire those two requests would be indistinguishable and
   * the switch could never be turned off. */
  notifications_enabled?: boolean;
  /** `uz` · `ru` · `en`. Anything else is a 400 — the column is 8 characters
   * wide, so a silent accept would let Postgres truncate it into nonsense. */
  preferred_language?: string;
}

/** How the one-time code reaches the user: a Telegram bot deep-link, or (dev)
 * an inline hint printed straight into the response. */
export type OtpDelivery = "telegram_bot" | "dev";

/** The Telegram delivery path the server picked for a phone:
 *  - `direct`    — a binding already exists; the code was DM'd straight to the
 *                  bound account, so there is no ownership step to wait on.
 *  - `deep_link` — no binding yet; the user opens the deep link, presses START
 *                  and shares their contact (ownership proof) before the code is
 *                  sent, so the app polls the delivery state for the verdict. */
export type TelegramMode = "direct" | "deep_link";

/** GET /api/auth/config → the sign-in capabilities of this deployment. */
export interface AuthConfigResponse {
  google: boolean;
  otp_delivery: OtpDelivery;
}

/** Everything a "we sent you a code" response has to tell the UI, shared by
 * every flow that mints an OTP (sign-in, registration, phone change). The OTP
 * step renders and polls off exactly these fields, so it works unchanged for
 * any of them. */
export interface OtpDeliveryInfo {
  delivery: OtpDelivery;
  /** Seconds until the code expires. */
  expires_in: number;
  /** Present when `delivery === "telegram_bot"`. In `direct` mode it is the
   *  PLAIN bot URL (open the chat and read the DM'd code); in `deep_link` mode
   *  it carries `?start=<token>` (press START, share the contact). */
  telegram_link: string | null;
  /** Which Telegram delivery path the server chose for this phone. Only
   *  meaningful when `delivery === "telegram_bot"`: `direct` DM'd the code to an
   *  already-bound account (no status to poll); `deep_link` needs the
   *  contact-share proof, so the app polls {@link OtpStatusResponse} for the
   *  mismatch/burn verdict. */
  telegram_mode: TelegramMode;
  /** Present when `delivery === "dev"` — the literal code. */
  dev_hint: string | null;
  /** Opaque id for polling {@link OtpStatusResponse}. It grants NOTHING on its
   * own — it maps only to a delivery state — so it is safe in a query string.
   * The deep-link token inside `telegram_link` is the secret and is never used
   * as the polling key. */
  request_id: string;
}

/** POST /api/auth/otp/request → where/when the code was sent.
 *  - `telegram_bot`: open `telegram_link` (a t.me/…?start=… deep-link).
 *  - `dev`: the code is `dev_hint` (e.g. "000000"). */
export interface OtpRequestResponse extends OtpDeliveryInfo {
  ok: boolean;
}

/** Telegram delivery state of one OTP request (`otp_req:{request_id}`), polled
 * only in `deep_link` mode (a `direct` DM has no ownership step to wait on):
 *  - `pending`          — code minted, the user hasn't opened Telegram yet
 *  - `awaiting_contact` — the bot asked them to share their contact
 *  - `sent`             — delivered to a Telegram account that PROVED it owns
 *                         the phone (contact share, `contact.user_id == from.id`)
 *  - `mismatch`         — the shared phone ≠ the requested one → code BURNED
 *  - `not_own_contact`  — someone else's contact was forwarded → code BURNED
 *  - `expired`          — the TTL elapsed, or the id is unknown */
export type OtpState =
  | "pending"
  | "awaiting_contact"
  | "sent"
  | "mismatch"
  | "not_own_contact"
  | "expired";

/** GET /api/auth/otp/status?request_id=… → the delivery state. Anonymous, and
 * ALWAYS HTTP 200 — an unknown id answers `expired` rather than 404, so the
 * endpoint can't be used to probe which request ids exist. */
export interface OtpStatusResponse {
  state: OtpState;
}

/** True once no further poll can change the outcome, i.e. the caller must stop
 * polling. `sent` is terminal SUCCESS; the burned states and `expired` are
 * terminal too. Anything the client doesn't recognise counts as terminal, so an
 * old build meeting a newer backend fails safe (stops) instead of polling
 * forever. */
export function isTerminalOtpState(state: OtpState): boolean {
  return state !== "pending" && state !== "awaiting_contact";
}

/** The "this phone has no account yet — send a name" branch of otp/verify. */
export interface NeedsRegistrationResponse {
  needs_registration: true;
}

/** POST /api/auth/otp/verify → a token pair (login OR register), OR a signal
 * that the phone is new and a `full_name` is required to complete sign-up. */
export type OtpVerifyResponse = TokenResponse | NeedsRegistrationResponse;

/** Narrow an otp/verify result to the "needs a name" branch. */
export function isNeedsRegistration(
  res: OtpVerifyResponse,
): res is NeedsRegistrationResponse {
  return (res as NeedsRegistrationResponse).needs_registration === true;
}

/** POST /api/auth/phone/change/request → the code was minted for the NEW phone.
 * Authenticated, and the pending change is bound server-side to the CALLING
 * user, so the new number never appears in a URL and no one else can confirm it.
 *
 * The Telegram contact-share proof is the whole point of the flow: the bot asks
 * the user to share their contact and releases the code only if the shared
 * number equals the NEW one — which is why the confirm step must reuse the
 * login OTP view (status polling included) rather than a bare code box. */
export type PhoneChangeRequestResponse = OtpDeliveryInfo;

/** GET /api/auth/dev/users → one seeded demo account per role, for the login
 * page's DEVELOPMENT-ONLY one-tap sign-in.
 *
 * It has NO entry in `openapi.json` and therefore none in `check:contract`, on
 * purpose: the document describes the API production serves, and these routes do
 * not exist there — the backend only maps them when `IsDevelopment()`, so
 * production answers 404. (The gate reports an unmatched type like this one as
 * "frontend-local", which is exactly what it is.) The .NET side is
 * `DevLoginEndpoints.DevUserResponse`, and it deliberately lives outside
 * `Govori.Contracts` for the same reason. */
export interface DevUserResponse {
  id: string;
  full_name: string;
  role: UserRole;
}

/* ── Catalog (CatalogContracts.cs) — Home + Practice ─────────────────────── */

export type QuestionType = "text" | "image" | "video";

export interface StudentTaskResponse {
  id: string;
  title: string;
  type: QuestionType;
  level: string | null;
  sort_order: number;
  done: boolean;
  /** SEQUENTIAL lock: the previous task in the module is not done yet. */
  locked: boolean;
  /** FREEMIUM lock: beyond the free preview of a public module, non-premium. */
  premium_locked: boolean;
  /** Best overall band (0..100) the caller earned on this task; null when never graded. */
  band: number | null;
  /* ── The task's own content, so the answer screen can show the QUESTION and not only its
   *    title. APPEND-ONLY. The four content fields mirror the document exactly (optional AND
   *    nullable): a locked task carries nulls for the prompt / instruction / media — the words
   *    are part of what premium unlocks — and the screen still degrades to the title alone
   *    when they are absent. The two timings are always sent. The model answer is deliberately
   *    NOT here: it is revealed only after submitting. ── */
  /** The Russian question/prompt the student answers aloud. */
  prompt_text?: string | null;
  /** The instruction ("shart") — how to answer: length, register, what to cover. */
  instruction_text?: string | null;
  /** Presigned GET url for the task's picture or clip; null when the task has none. */
  media_url?: string | null;
  media_type?: "image" | "video" | null;
  /** "Collect your thoughts" seconds before capture starts; 0 = no prep step. */
  prep_time_sec: number;
  /** Hard cap on the answer, seconds; the recorder auto-stops here. 0 = the Recorder's default. */
  answer_time_limit_sec: number;
}

export type ModuleVisibility = "public" | "group";

export interface StudentModuleResponse {
  id: string;
  name: string;
  topic: string | null;
  level: string | null;
  ru_style: string | null;
  visibility: ModuleVisibility;
  cover_url: string | null;
  total: number;
  done_count: number;
  /** First actionable task (not done, not locked, not premium-locked). */
  next_task_id: string | null;
  tasks: StudentTaskResponse[];
  /** Caller's total time on this module in whole seconds (sum of submission durations); 0 when none. */
  spent_sec: number;
}

/* ── Practice (PracticeContracts.cs) ─────────────────────────────────────── */

export type SubmissionStatus = "pending" | "processing" | "done" | "failed";

export interface SubmissionResponse {
  id: string;
  student_id: string;
  question_id: string | null;
  reference_text: string | null;
  audio_key: string;
  audio_url: string | null;
  audio_duration_sec: number | null;
  status: SubmissionStatus;
  /** A grading-failure MACHINE CODE (`grading_timeout` · `stt_failed` · `grader_failed` ·
   * `internal`) — never text to show. Rows that failed before the codes existed still hold
   * free text. Map it through `gradingFailureKey` (app/adapters): anything unknown reads as
   * `internal`. */
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  student_name: string | null;
  question_title: string | null;
  question_topic: string | null;
  question_level: string | null;
  model_answer_text: string | null;
  teacher_comment: string | null;
  teacher_band: number | null;
  reviewed_at: string | null;
  /** AI scores 0..100, null until graded. Present on every LIST row, so a
   * teacher view never has to fetch `/detail` per attempt just for a number. */
  overall_band: number | null;
  fluency_score: number | null;
  lexical_score: number | null;
  grammar_score: number | null;
  pronunciation_score: number | null;
}

/** GET /api/submissions/{id}/detail — one attempt's full detail (audio + transcript
 * + AI score breakdown). Scores are 0..100; null until graded. `audio_url` is null
 * once the retention job purges the recording (`audio_expired: true`). */
export interface AttemptDetailResponse {
  id: string;
  status: SubmissionStatus;
  created_at: string;
  completed_at: string | null;
  question_title: string | null;
  question_topic: string | null;
  question_level: string | null;
  reference_text: string | null;
  model_answer_text: string | null;
  audio_url: string | null;
  audio_duration_sec: number | null;
  audio_expired: boolean;
  transcript: string | null;
  band: number | null;
  overall_band: number | null;
  fluency_score: number | null;
  lexical_score: number | null;
  grammar_score: number | null;
  pronunciation_score: number | null;
  relevance_score: number | null;
  feedback: string | null;
  corrections: string | null;
  teacher_band: number | null;
  teacher_comment: string | null;
  reviewed_at: string | null;
  /** Per-word pronunciation, parsed server-side from the STT payload. EMPTY (never
   * null) when the attempt has no word data — an older row, or a provider that
   * returned none. Each `word` is what the student ACTUALLY said, verbatim: it is
   * never corrected or swapped for the expected word. */
  words: TranscriptWordResponse[];
  /** Who recorded it. Present so a teacher opening an attempt by direct link can
   * identify it — this DTO was written for the student's own result screen, where
   * their own name would be redundant. */
  student_name: string | null;
}

/** One transcript word with its pronunciation accuracy. */
export interface TranscriptWordResponse {
  word: string;
  /** Seconds from the start of the recording, for seeking. */
  start: number | null;
  end: number | null;
  /** Accuracy 0..100; null when the provider gave none. */
  accuracy: number | null;
  /** Provider label, e.g. "None" | "Mispronunciation" | "Omission". */
  error_type: string | null;
}

/* ── Placement (PlacementContracts.cs) — one-time post-register CEFR check ── */

/** GET /api/placement/questions → the 3 fixed Russian prompts. */
export interface PlacementQuestionResponse {
  index: number;
  prompt_ru: string;
}

/** POST /api/placement/submit → the per-answer band (0–100). Grading is STUBBED
 * (deterministic) until real AI keys land, so the band is approximate. */
export interface PlacementSubmitResponse {
  index: number;
  band: number;
}

/** POST /api/placement/complete → the estimated CEFR level + its short Uzbek
 * label (e.g. A2 · "boshlang'ich") + the averaged band. */
export interface PlacementResultResponse {
  level: string;
  label_uz: string;
  band: number;
}

/* ── Engagement (EngagementContracts.cs) — Progress ──────────────────────── */

export interface LeaderboardEntryResponse {
  rank: number;
  id: string;
  full_name: string;
  xp: number;
  weekly_xp: number;
  current_streak: number;
  is_me: boolean;
}

/* ── Progress (EngagementContracts.cs) — the redesigned Progress screen ───── */

/** One of the four CEFR sub-skills, scored 0..100 (rounded). `key` is one of
 * `fluency` | `pronunciation` | `lexical` | `grammar`, and the four are ALWAYS
 * returned in that order — a skill with no scores yet reads 0 (an empty bar). */
export interface ProgressSkill {
  key: string;
  score: number;
}

/** One weekly average of the caller's OverallBand, for the band-trend sparkline.
 * `week_index` is a 0-based x-axis sequence (oldest → newest), NOT a calendar
 * week id. */
export interface ProgressTrendPoint {
  week_index: number;
  band: number;
}

/** GET /api/progress/skills → the student view of the CALLER's skills (auth; the
 * user comes from the bearer token). Everything is computed on the fly from the
 * caller's evaluations — no stored aggregate.
 *
 * `level` / `level_label` are the CEFR level derived from the average band (e.g.
 * "A2" · "boshlang'ich"), null together when nothing is graded yet — the UI then
 * shows an empty state instead of the level + trend. `band` is the current avg
 * OverallBand (1dp). `band_delta` is `band now − band as of delta_weeks ago`, and
 * is null (with `delta_weeks` 0) when there are fewer than 2 weeks of history, so
 * the UI hides the trend line. `trend` is the weekly averages oldest → newest,
 * capped to the last ~8–12 points ([] when none). */
export interface ProgressSkillsResponse {
  level: string | null;
  level_label: string | null;
  band: number | null;
  band_delta: number | null;
  delta_weeks: number;
  trend: ProgressTrendPoint[];
  skills: ProgressSkill[];
}

/** One row of the leaderboard neighbour window. `xp` is the XP FOR the chosen
 * period; `is_me` marks the caller's own row. */
export interface LeaderboardRow {
  rank: number;
  id: string;
  full_name: string;
  xp: number;
  is_me: boolean;
}

/** GET /api/progress/leaderboard?period=weekly|monthly|all → the caller's
 * standing among all students for the chosen period (auth; student view).
 *
 * `period` echoes the request. `league` is derived from `percentile`
 * ("gold" ≤ 10, "silver" ≤ 35, else "bronze"). `my_rank` / `total_students` /
 * `percentile` ("top X%", 1..100) describe the position; `my_xp` is the caller's
 * XP for the period (weekly / monthly / all-time). `rank_delta` is
 * `previous-period rank − my_rank` (positive = climbed N places), best-effort and
 * null when not computable (e.g. the "all" period). `neighbors` is the window of
 * rows AROUND the caller (a few above + the caller + a few below), ascending by
 * rank, and always includes the caller (`is_me`). */
export interface ProgressLeaderboardResponse {
  period: string;
  league: string;
  my_rank: number;
  total_students: number;
  percentile: number;
  my_xp: number;
  current_streak: number;
  rank_delta: number | null;
  neighbors: LeaderboardRow[];
}

/* ── Profile (ProfileContracts.cs) — the Profile screen ──────────────────── */

/** GET /api/profile/stats → the four "Natijalar" tiles for the current user.
 * Everything is computed on the fly from existing columns (submissions,
 * evaluations, User.CurrentStreak) — nothing here is a stored aggregate.
 * `avg_band` is rounded to 1dp and is null until a first attempt is graded;
 * `total_practice_sec` is seconds and the UI renders it as hours to 1dp
 * ("6.4 soat"). `level` / `level_label` are derived exactly like on
 * {@link MeResponse} and are null together. */
export interface ProfileStatsResponse {
  attempts: number;
  avg_band: number | null;
  current_streak: number;
  longest_streak: number;
  total_practice_sec: number;
  level: string | null;
  level_label: string | null;
  /** Lifetime XP total (`User.Xp`) — the headline gamification number the profile
   * surfaces as its XP banner. Grows on each graded exercise. */
  xp: number;
  /** Practice seconds today / in the last 7 days (UTC window) — the Home screen's
   * "Bugungi N daqiqa" progress and the "Bu hafta" tile. Append-only. */
  today_practice_sec: number;
  week_practice_sec: number;
}

/** Direction of a result versus the chronologically previous graded attempt.
 * "flat" doubles as the "no previous attempt" case. */
export type ResultTrend = "up" | "down" | "flat";

/** GET /api/profile/results → one row of "SO'NGGI NATIJALAR", newest first and
 * graded only. `title` is the question title with a "Mashq" fallback baked in
 * server-side, so it is never null. `band` is the rounded 0..100 overall band.
 * `trend` is computed over the whole ordered set, not pairwise on the returned
 * page, so the oldest item on a page still compares against the attempt before
 * it. */
export interface ProfileResultItemResponse {
  id: string;
  title: string;
  band: number;
  created_at: string;
  trend: ResultTrend;
}

/** GET /api/profile/achievements → the fixed three-item catalogue, evaluated
 * against the user's real numbers and always returned in the same order
 * (`streak_12`, `attempts_50`, `level_b1`). Titles and emoji live in the
 * frontend locale files keyed off `key` — the backend ships numbers only.
 * `unlocked` is just `progress >= target`, precomputed for convenience. */
export interface AchievementResponse {
  key: string;
  progress: number;
  target: number;
  unlocked: boolean;
}

/* ── Classroom (ClassroomContracts.cs) — groups ──────────────────────────── */

/** GET /api/groups/mine → the groups the current user belongs to. The Profile
 * screen renders its "GURUH VA O'QITUVCHI" block only when this is non-empty,
 * and reads the first entry. `teacher_id` / `teacher_name` are null on a group
 * whose owner was removed. */
export interface GroupResponse {
  id: string;
  name: string;
  join_code: string;
  member_count: number;
  teacher_id: string | null;
  teacher_name: string | null;
  created_at: string;
}

/** One student inside a group's roster (`GroupDetailResponse.members`). */
export interface GroupMemberResponse {
  id: string;
  full_name: string;
  email: string;
  is_premium: boolean;
  submission_count: number;
  /** When they joined the group — the "qo'shilgan mart" line on A6. */
  joined_at: string;
}

/** GET /api/groups/{id} → a group plus its roster (owner/admin only). This is
 * the AUTHORITATIVE membership list: the gradebook only carries students who
 * have actually answered one of this teacher's questions, so a member with no
 * attempts appears here and NOT there. The teacher's Klasslar screen builds its
 * roster from this and merges scores in from the gradebook. */
export interface GroupDetailResponse extends GroupResponse {
  members: GroupMemberResponse[];
}

/** POST /api/groups/join → an ADDITIVE superset of {@link GroupResponse}: every old field is
 * still there, plus `pending`. `pending: true` means a join REQUEST was filed and the owning
 * teacher must approve it — the caller is NOT a member yet. `pending: false` means they already
 * were one (re-joining is a no-op). Treating a `pending` join as membership is exactly the bug
 * this flag exists to prevent. */
export interface JoinGroupResponse extends GroupResponse {
  pending: boolean;
}

/* ── Classroom · group + assignment management (A5 "Sozlama", "Faol topshiriqlar") ──
 * Every 400 these routes produce carries a machine `code` beside the human `detail`
 * ({ detail, code }); the UI branches on the code and never prints the detail. */

/** The error body of a refusal that carries a machine reason — `due_in_past`,
 * `name_too_long`, `question_not_published`, `confirm_with_band`, … It arrives on
 * a non-2xx response, so it is read off `ApiError.body` (see `apiErrorCode` in
 * app/teacherAdapters), never returned from an endpoint function. `detail` is
 * developer prose and is never rendered; `code` is mapped to i18n. */
export interface CodedErrorResponse {
  detail: string;
  code: string;
}

/** PATCH /api/groups/{id} body → {@link GroupResponse}. An absent field is left
 * alone. `name` is trimmed; blank → 400 `name_required`, >128 chars → 400
 * `name_too_long`.
 *
 * `level` exists on the wire and is REFUSED (400 `level_not_supported`): `groups`
 * has no level column — a group card's CEFR badge is derived from its students'
 * scores. The UI therefore never sends it; it is mirrored here only so the
 * contract gate sees the same shape the server declares. */
export interface UpdateGroupArgs {
  name?: string | null;
  level?: string | null;
}

/** POST /api/assignments/cancel body — take one task back from one group: every
 * row of the caller's for `question_id` that was assigned THROUGH `group_id`.
 * Students' answers and grades are untouched. */
export interface CancelGroupAssignmentsArgs {
  question_id: string;
  group_id: string;
}

/** POST /api/assignments/cancel → how many assignment rows were removed. 0 is a
 * normal answer (idempotent), not an error — e.g. the task reached the students
 * through A6's single-student assign, not through the group. */
export interface CancelGroupAssignmentsResponse {
  cancelled: number;
}

/** PATCH /api/assignments/group body — move one task's deadline across one group.
 * `due_at` is REQUIRED and may be null: an ISO instant sets the deadline, an
 * explicit `null` removes it ("muddatsiz"). Omitting the key is a 400
 * `due_at_required` — the server will not read a forgotten field as "no
 * deadline" for a whole group. A past instant is 400 `due_in_past`. */
export interface UpdateGroupAssignmentsArgs {
  question_id: string;
  group_id: string;
  due_at: string | null;
}

/** PATCH /api/assignments/group → how many rows now carry the new deadline. */
export interface UpdateGroupAssignmentsResponse {
  updated: number;
}

/** PATCH /api/classroom/students/{id}/premium body. `is_premium` is required — a
 * body without it is a 400 `is_premium_required`, never a silent revoke. */
export interface SetStudentPremiumArgs {
  is_premium: boolean;
}

/** PATCH /api/classroom/students/{id}/premium → the stored grant AND what the
 * student actually has. `is_premium` is the grant this route writes — the
 * switch's state. `has_premium` is the grant OR an active paid subscription, so it
 * can be true with the switch off (the student pays for themselves). The A6 switch
 * reads `is_premium` back from HERE after every write, never from its own guess. */
export interface StudentPremiumResponse {
  id: string;
  is_premium: boolean;
  has_premium: boolean;
}

/** One of the caller's groups a student sits in (A6 header). */
export interface ClassroomStudentGroupResponse {
  id: string;
  name: string;
  joined_at: string;
}

/** GET /api/classroom/students/{id} → the A6 header: who the student is, the
 * premium grant (so the screen can draw the switch) and which of the caller's
 * groups they are in. A teacher reads only their own roster — anyone else is a
 * 404, which is also how "this route is not deployed yet" looks, so a failure
 * simply leaves the premium switch out. */
export interface ClassroomStudentResponse {
  id: string;
  full_name: string;
  email: string;
  /** The teacher/admin grant — the switch's state. */
  is_premium: boolean;
  /** Effective premium: the grant OR an active subscription. */
  has_premium: boolean;
  groups: ClassroomStudentGroupResponse[];
}

/** A pending join request. Used by BOTH sides: the teacher's "So'rovlar" tab
 * (`GET /api/groups/requests`, their own groups only) and the student's own waiting state
 * (`GET /api/groups/requests/mine`). Carries the group name + code so a row reads standalone. */
export interface GroupJoinRequestResponse {
  id: string;
  group_id: string;
  group_name: string;
  join_code: string;
  student_id: string;
  student_name: string;
  student_email: string;
  created_at: string;
}

/** One student's line in `GET /api/reports/gradebook`. `avg_band` / `best_band`
 * are 0–100 speaking bands (null until the student has a graded attempt) — the
 * same scale `CefrScale` buckets into A1…C1. */
export interface GradebookRowResponse {
  student_id: string;
  full_name: string;
  email: string;
  attempts: number;
  avg_band: number | null;
  best_band: number | null;
  last_activity: string | null;
  /* The four per-criterion averages, APPENDED in Phase 6 so the Jurnal can show
   * "Ravon. · Gram." beside the overall band without one detail request per
   * student. Null when the student has no graded attempt — never 0, which would
   * read as "scored zero" rather than "never measured". */
  fluency: number | null;
  grammar: number | null;
  pronunciation: number | null;
  lexical: number | null;
  /** Which way the student is moving: the newer half of their recent graded
   * answers minus the older half. Positive = improving. Backs A4's ↑/↓ arrow and
   * A1's "N o'quvchi ball tushirdi" card.
   *
   * Null under four graded answers — one answer is not a direction — and it is
   * NOT the difference between two `avg_band` values, so never label it that way. */
  trend_delta: number | null;
}

/* ── Analitika · D1 Insaytlar (GET /api/reports/insights) ─────────────────── */

/** One month of the hero chart. `avg` is null for a month with no graded
 * attempt — the line must GAP there, not drop to zero. */
export interface InsightsTrendPoint {
  year: number;
  /** 1–12, matching the `time.month1` … `time.month12` keys. */
  month: number;
  avg: number | null;
  attempts: number;
}

/** Class-wide averages per criterion, 0–100. Null = nothing scored yet. */
export interface InsightsSkills {
  fluency: number | null;
  grammar: number | null;
  pronunciation: number | null;
  lexical: number | null;
}

/** One day of the "Haftalik faollik" chart. `date` is `YYYY-MM-DD`, local. */
export interface InsightsWeekDay {
  date: string;
  attempts: number;
}

/** One row of "Ko'p uchragan xatolar". `type` is a stable machine key
 * (`word_order`, `relevance`, …) that the UI localizes via `teacher.errorType.*`,
 * falling back to the raw string for a type it does not know yet. `share` is
 * 0–1, not a percentage. */
export interface InsightsErrorPattern {
  type: string;
  count: number;
  student_count: number;
  share: number;
  /** F6 · what one tap of "Mashq ber" would send for this row, or `null` when
   * there is nothing to send (no assignable task, or the row is under
   * {@link InsightsResponse.remediation_min_students}). Always null while
   * `remediation_enabled` is false. */
  remediation: InsightsRemediation | null;
}

/** One recipient of a remediation assignment. */
export interface InsightsRemediationStudent {
  id: string;
  full_name: string;
}

/**
 * F6 · the server's remediation plan for one error row: ONE task, and exactly the
 * students to send it to.
 *
 * The task is not guessed from the topic — nothing in the data maps an error type
 * to a topic. It is the question this error type actually occurred on most often
 * in the caller's scope, which is the only measured link between the two.
 *
 * `students` can be EMPTY while the task exists: everyone affected already has it
 * open. That disables the button with "they all have it", which is a different
 * message from "there is no drill for this".
 */
export interface InsightsRemediation {
  question_id: string;
  question_title: string;
  question_topic: string | null;
  question_level: string | null;
  students: InsightsRemediationStudent[];
}

/**
 * GET /api/reports/insights (?group_id) → the teacher's class analytics
 * (D1 Insaytlar). Teacher/admin only; scoped server-side to the caller's own
 * roster and questions, exactly like the gradebook.
 *
 * Every aggregate is nullable on purpose: a brand-new teacher has no attempts,
 * and an honest empty state beats a wall of zeros. `trend` is always exactly 3
 * entries (oldest first, current month last) and `week` always exactly 7 (oldest
 * first, ending today), so the charts have a stable axis even at zero.
 */
export interface InsightsResponse {
  class_avg: number | null;
  class_level: string | null;
  class_level_label: string | null;
  /** Points gained/lost between the two most recent months that BOTH have a
   * graded average — empty months are skipped rather than nulling the chip, since
   * "this month minus last month" is blank for the first days of every month.
   * Null when fewer than two months have anything graded. */
  trend_delta: number | null;
  trend: InsightsTrendPoint[];
  active_students: number;
  total_students: number;
  assignments_done: number;
  assignments_total: number;
  /** Seconds of practice this week; the UI shows minutes. */
  practice_sec_week: number;
  reviewed_week: number;
  skills: InsightsSkills;
  week: InsightsWeekDay[];
  /** Top 5, most frequent first. */
  errors: InsightsErrorPattern[];
  /** Whether F6's one-tap remediation exists in this deployment
   * (`class_insights_enabled`). False ⇒ draw no "Mashq ber" button at all; an
   * absent feature must not present itself as a broken one. */
  remediation_enabled: boolean;
  /** How many DISTINCT students must have made an error before a drill is offered
   * for it — the "12 o'quvchi qoqildi" bar. `0` when the feature is off. It comes
   * from the server so the threshold has ONE definition; the client uses it only
   * to explain a disabled button, never to decide one. */
  remediation_min_students: number;
}

/** GET /api/assignments/mine → the caller's assignments. The Home screen shows
 * the soonest incomplete one ("Keyingi topshiriq"). `question_title` is the task
 * name; `due_at` is the deadline (null = no deadline); `completed` marks done. */
/** Body of POST /api/assignments — assign one task to a group and/or explicit
 * students. `due_at` is ISO-8601 or omitted for no deadline; `max_attempts` is
 * 1–10 or omitted for unlimited (a 400 outside that range). Submit enforces it,
 * so it is a real constraint and not a label. */
export interface CreateAssignmentArgs {
  question_id: string;
  group_id?: string;
  student_ids?: string[];
  due_at?: string;
  max_attempts?: number;
}

/** Body of POST /api/assignments/module — assign a whole module's published tasks.
 * `max_attempts` applies to EVERY task the module hands out, per task. */
export interface CreateModuleAssignmentArgs {
  block_id: string;
  group_id?: string;
  student_ids?: string[];
  due_at?: string;
  max_attempts?: number;
}

export interface AssignmentResponse {
  id: string;
  student_id: string;
  student_name: string | null;
  question_id: string;
  question_title: string | null;
  question_topic: string | null;
  question_level: string | null;
  due_at: string | null;
  created_at: string;
  completed: boolean;
  submission_id: string | null;
  overall_band: number | null;
  /** Attempt budget, or null for unlimited. */
  max_attempts: number | null;
  /** Attempts already spent on THIS assignment. Excludes answers whose grading
   * failed — the same rule submit enforces, so "2/3" and a refusal agree. */
  attempts_used: number;
}

/* ── Settings (SettingsContracts.cs) ─────────────────────────────────────── */

/** GET /api/settings/links → the deployment's Telegram destinations, powering
 * the "Yordam markazi" modal. Both are absolute `https://t.me/…` URLs. */
/** GET /api/admin/settings/features — the Faza 6 switches. Separate from the AI
 *  settings because they decide whether a surface EXISTS, not how the AI behaves. */
export interface FeatureFlagsResponse {
  review_drill_enabled: boolean;
  roleplay_enabled: boolean;
  roleplay_max_turns: number;
  roleplay_daily_turns: number;
  /** F6 · the teacher's one-tap remediation on Analitika · Insaytlar. */
  class_insights_enabled: boolean;
  /** F3 · «Kunlik 5 daqiqa» — the daily session and its Home entry point. */
  daily_five_enabled: boolean;
  /** Faza 6.6 · the payment surface. Off by default, and NOT the only gate: a checkout is
   *  still refused while no provider is configured, so turning this on cannot open a flow
   *  that takes money nothing can collect. */
  payments_enabled: boolean;
  /** F2 · the minimal-pair phoneme drill. Off by default because every attempt
   *  costs a speech-vendor call — and two when the learner missed. */
  phoneme_drill_enabled: boolean;
  /** F2 · attempts per student per UTC day. The product ceiling; the burst
   *  ceiling is a separate server-side rate limit. */
  phoneme_drill_daily_attempts: number;
}

/** PATCH body. Everything is a string, booleans included — the tri-state needs
 *  three states (omit = keep, "" = clear to the env default, value = store) and a
 *  `boolean | undefined` can only express two. */
export interface FeatureFlagsUpdateArgs {
  review_drill_enabled?: string;
  roleplay_enabled?: string;
  roleplay_max_turns?: string;
  roleplay_daily_turns?: string;
  class_insights_enabled?: string;
  daily_five_enabled?: string;
  payments_enabled?: string;
  phoneme_drill_enabled?: string;
  phoneme_drill_daily_attempts?: string;
}

export interface LinksResponse {
  tg_support_url: string;
  tg_channel_url: string;
}

/* ── Kunlik 5 daqiqa (DailyContracts.cs — docs/08 Faza 6.3) ───────────────── */

/** One warm-up line to read aloud. `level` is a free-text CEFR label the content
 * owner typed ("A1–A2") — a label, not a scale, so it is shown as-is. */
export interface DailyPhraseResponse {
  id: string;
  text: string;
  level: string;
}

/** One step of today's session.
 *
 * A step the student cannot do today is ABSENT from `steps`, never present with
 * a zero in it: a drill step reporting "0 ta element" would turn a two-minute
 * session into a screen mostly reporting its own emptiness.
 *
 * `done` is OBSERVED, not asserted — derived from rows the student's own actions
 * wrote inside today's local day (a submission for `task`, an answered review for
 * `drill`). The warm-up leaves no server-side trace and therefore always arrives
 * `false`; the client remembers that one locally. */
export interface DailyStepResponse {
  kind: "warmup" | "task" | "drill";
  done: boolean;
  est_seconds: number;
  phrases: DailyPhraseResponse[];
  task_id: string | null;
  task_title: string | null;
  module_name: string | null;
  level: string | null;
  due_count: number | null;
}

/** GET /api/daily → today's session, in order.
 *
 * `day` is the STUDENT's local day (`yyyy-MM-dd`, resolved from the `tz_offset`
 * the client sends), not the server's UTC day — a session that rolled over at UTC
 * midnight would end someone's evening practice mid-sentence.
 *
 * The session is stable for that day: asking twice returns the same exercises. A
 * refresh that reshuffled them would turn the one screen built to remove choice
 * back into a chooser.
 *
 * A **404** from this route means the `daily_five_enabled` flag is off in this
 * deployment — the documented "not shipped here" signal (docs/08 Faza 6, deploy ≠
 * release), not an error: callers hide the entry point. */
export interface DailySessionResponse {
  day: string;
  streak: number;
  completed: boolean;
  steps: DailyStepResponse[];
}

/* ── Xato-replay drill (EngagementContracts.cs — docs/08 Faza 6.1) ────────── */

/** GET /api/review/drill → one card of a drill session: a question the student
 * got wrong, with the full text they have to say again (the queue's list shape
 * carries only a title — a drill card needs the words).
 *
 * `weakness_dim` is WHY it is here: one of fluency · lexical · grammar ·
 * relevance, or "teacher" when a teacher queued it by hand. Treat it as an open
 * string — an unknown dimension must still render, so the screen falls back to
 * the raw value rather than dropping the card.
 *
 * `round` / `total_rounds` are 1-based ("2 / 5"): the position on the spaced
 * repetition ladder, counted the way a person counts their own revisions. */
export interface ReviewDrillItemResponse {
  id: string;
  question_id: string;
  question_title: string;
  prompt_text: string;
  instruction_text: string | null;
  model_answer_text: string | null;
  question_topic: string | null;
  question_level: string | null;
  weakness_dim: string;
  round: number;
  total_rounds: number;
  due_at: string;
}

/** GET /api/review/drill → the session. `due_count` is everything due right now
 * while `items` is only the slice this session serves, so a student with forty
 * overdue items is handed a finishable set — the screen shows both numbers
 * rather than implying the shorter one is the whole backlog.
 *
 * A **404** from this route means the `review_drill_enabled` flag is off in this
 * deployment. That is the documented "not shipped here" signal (docs/08 Faza 6 —
 * deploy ≠ release), not an error to surface: callers hide the entry point. */
export interface ReviewDrillResponse {
  due_count: number;
  total_rounds: number;
  items: ReviewDrillItemResponse[];
}

/** POST /api/review/{id}/answer — the student's verdict on their own replay.
 * "good" climbs a rung of the ladder, "again" drops it back to the first
 * interval. Nothing else is accepted (400), because a guessed default would
 * quietly corrupt a schedule the student cannot see. */
export type ReviewAnswerOutcome = "good" | "again";

/** POST /api/review/{id}/answer → the ladder after the answer. `next_due_at` is
 * null exactly when `graduated` is true — the item survived every interval and
 * will not come back. `remaining_due` is the server's recount AFTER this answer,
 * so the session advances on a fact rather than on its own optimism. */
export interface ReviewAnswerResponse {
  id: string;
  round: number;
  total_rounds: number;
  graduated: boolean;
  next_due_at: string | null;
  remaining_due: number;
}

/* ── Notifications (NotificationContracts.cs) — the header bell ──────────── */

/** GET /api/notifications → one row of the notifications centre, newest first.
 * `type` is an open-ended server-side discriminator (e.g. a graded submission,
 * a streak reminder) — treat it as an opaque string and never switch on it for
 * anything the user must see, so a type this build doesn't know still renders.
 * `body` is the optional second line and `link` an optional in-app destination;
 * both are null on a bare title-only notification. `is_read` drives the unread
 * dot and flips via the read / read-all routes. `created_at` is ISO-8601 UTC —
 * the UI formats it against LOCAL calendar days with `profile.relativeDate.*`. */
export interface NotificationResponse {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

/** GET /api/notifications/unread-count → the badge number for the bell. It is
 * the count of the caller's own unread rows, taken from the bearer token. */
export interface UnreadCountResponse {
  count: number;
}

/* ── Teacher authoring (CatalogContracts.cs — Kontent board) ──────────────── */

/** GET /api/blocks → one module as its owning teacher sees it. `student_count` is
 * the teacher's roster reach, and is 0 for a DRAFT — a draft reaches nobody, so
 * showing a count on one would be a lie. */
export interface TeacherBlockResponse {
  id: string;
  name: string;
  topic: string | null;
  level: string | null;
  ru_style: string | null;
  /** `public` (an official module — every student sees it; set by an admin only) ·
   * `group` (the author's own students) · `private` (the author alone). */
  visibility: string;
  is_published: boolean;
  sort_order: number;
  task_count: number;
  student_count: number;
  created_at: string;
  updated_at: string;
  /** Full name of the module's owner. Additive: an admin's list holds every
   * teacher's modules and needs it to tell them apart; a teacher's list is all
   * their own. Optional so an older API image still type-checks. */
  owner_name?: string;
}

/** GET /api/blocks/{id} → the module plus its ordered tasks (the C4 editor). */
export interface TeacherBlockDetailResponse extends TeacherBlockResponse {
  tasks: TeacherQuestionResponse[];
}

/** One task as its owning teacher sees it (Vazifalar tab + C5's picker). */
export interface TeacherQuestionResponse {
  id: string;
  title: string;
  prompt_text: string;
  type: string;
  level: string | null;
  topic: string | null;
  ru_style: string | null;
  instruction_text: string | null;
  model_answer_text: string | null;
  prep_time_sec: number;
  answer_time_limit_sec: number;
  is_published: boolean;
  is_public: boolean;
  block_id: string | null;
  /** The task cover — an image or short video — as a PRESIGNED-GET url minted per
   * request from `Question.MediaKey`. A short-lived download link, never a stored
   * column, like a submission's `audio_url`. Null when the task has no media. */
  media_url: string | null;
  /** Name of the module it belongs to; null when unattached. */
  block_name: string | null;
  sort_order: number;
  /** How many attempts exist — an edit to a task students already answered is
   * worth warning about. */
  submission_count: number;
  created_at: string;
  updated_at: string;
}

/** POST /api/blocks body. Only `name` is required; a module starts as a DRAFT. */
export interface CreateBlockArgs {
  name: string;
  topic?: string | null;
  level?: string | null;
  ru_style?: string | null;
  visibility?: string | null;
}

/** PATCH /api/blocks/{id} body. ABSENT means "leave alone", so publishing is
 * `{ is_published: true }` with no risk of blanking anything else. */
export interface UpdateBlockArgs {
  name?: string;
  topic?: string | null;
  level?: string | null;
  ru_style?: string | null;
  visibility?: string;
  is_published?: boolean;
  sort_order?: number;
}

/** POST /api/questions body. `title` + `prompt_text` are required. */
export interface CreateQuestionArgs {
  title: string;
  prompt_text: string;
  level?: string | null;
  topic?: string | null;
  ru_style?: string | null;
  instruction_text?: string | null;
  model_answer_text?: string | null;
  prep_time_sec?: number;
  answer_time_limit_sec?: number;
  /** Attach straight to a module (the C4 "+ Yangi vazifa" path). */
  block_id?: string | null;
}

/** PATCH /api/questions/{id} body. `detach_block: true` removes the module link —
 * over JSON an absent `block_id` and an explicit null are indistinguishable, so
 * detaching needs its own flag. */
export interface UpdateQuestionArgs {
  title?: string;
  prompt_text?: string;
  level?: string | null;
  topic?: string | null;
  ru_style?: string | null;
  instruction_text?: string | null;
  model_answer_text?: string | null;
  prep_time_sec?: number;
  answer_time_limit_sec?: number;
  is_published?: boolean;
  sort_order?: number;
  block_id?: string;
  detach_block?: boolean;
}

/* ── Administration (AdminContracts.cs) ──────────────────────────────────── */

/** GET /api/admin/stats → the six counters the admin landing page shows.
 * Deliberately a small, honest set: everything here is a COUNT the database can
 * answer directly. The mockup's revenue, ratings, retention and moderation cards
 * have no tables behind them and are not faked. */
export interface AdminStatsResponse {
  teachers: number;
  students: number;
  questions: number;
  published_questions: number;
  submissions: number;
  evaluated_submissions: number;
  /** Answers still queued or being graded — work in progress, not a problem. */
  pending_submissions: number;
  /** Answers whose grading ended in an error. Counted apart from `pending`, because
   * "2 answers are still ungraded" used to include these, and an admin cannot wait
   * a failure out. */
  failed_submissions: number;
}

/** GET /api/admin/teachers (?search) → one row per teacher. `?search=` matches the
 * name, the email AND the phone digits. */
export interface AdminTeacherResponse {
  id: string;
  email: string;
  full_name: string;
  /** The real sign-in number. `email` is only a `{phone}@govori.uz` placeholder
   * built from it, so the rows show this and never the email. Null on legacy rows. */
  phone: string | null;
  is_active: boolean;
  created_at: string;
  /** Tasks they authored — also what a deletion would destroy. */
  question_count: number;
}

/** GET /api/admin/admins → one row per admin: the teacher row plus `is_self`. */
export interface AdminUserResponse extends AdminTeacherResponse {
  /** True for the caller's own row — the one row that offers no role change (the
   * server refuses `cannot_change_own_role`). */
  is_self: boolean;
}

/** POST /api/admin/teachers — create a teacher account up front. The teacher then
 * signs in with this phone through the usual Telegram code; there is no password.
 * Refusals: 409 {@link PhoneTakenByStudentResponse} · 409 `phone_taken` · 400
 * `invalid_phone` · 400 `invalid_full_name`. */
export interface CreateTeacherArgs {
  /** E.164, `+998…`. */
  phone: string;
  full_name: string;
}

/** PATCH /api/admin/users/{id}/role. Refusals: 400 `cannot_change_own_role` ·
 * 400 `invalid_role` · 409 `last_admin` · 409 {@link TeacherOwnsGroupsResponse}. */
export interface UserRoleUpdateArgs {
  role: UserRole;
}

export interface UserRoleResponse {
  id: string;
  role: UserRole;
}

/** 409 `phone_taken_by_student` — the number is a STUDENT's; the add sheet names them
 * and offers the promotion instead of dead-ending on "taken". */
export interface PhoneTakenByStudentResponse extends CodedErrorResponse {
  user_id: string;
  full_name: string;
}

/** 409 `teacher_owns_groups` — the count is what the refusal sentence names. */
export interface TeacherOwnsGroupsResponse extends CodedErrorResponse {
  group_count: number;
}

/** 400 `invalid_link` on PATCH /api/admin/settings/links — `field` is the refused
 * link, so the message lands on that input. */
export interface InvalidLinkResponse extends CodedErrorResponse {
  field: string;
}

/** Any Administration refusal as it arrives on `ApiError.body`: the shared
 * {@link CodedErrorResponse} plus whichever extra the code carries. Everything is
 * optional because the body is read off an unknown error, never trusted. `detail`
 * is developer prose and is never rendered. */
export type AdminErrorBody = Partial<
  PhoneTakenByStudentResponse & TeacherOwnsGroupsResponse & InvalidLinkResponse
>;

/** PATCH /api/admin/teachers/{id}. Null/omitted = leave unchanged. There is no
 * password field: setting one needs the frozen auth hasher, which the
 * Administration module deliberately does not reference. */
export interface AdminTeacherUpdateArgs {
  full_name?: string;
  is_active?: boolean;
}

/** GET /api/admin/students (?search) → one row per student. */
export interface AdminStudentResponse {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  region: string | null;
  district: string | null;
  age: number | null;
  is_active: boolean;
  is_premium: boolean;
  created_at: string;
  /** Answers recorded — also what a deletion would destroy. */
  submission_count: number;
}

/** PATCH /api/admin/students/{id}. The freemium grant/revoke rides `is_premium`. */
export interface AdminStudentUpdateArgs {
  full_name?: string;
  is_active?: boolean;
  is_premium?: boolean;
}

/** A secret is never sent to the client — only whether it is set, plus a hint
 * (its last characters). The raw value comes from `GET /api/admin/reveal/{key}`
 * on an explicit, deliberate request. */
export interface SecretState {
  set: boolean;
  hint: string;
}

/** One entry in a curated model dropdown (Gemini, Claude, …). */
export interface KnownModel {
  id: string;
  label: string;
  note: string;
}

/** GET /api/admin/ai → the grader + STT settings, secrets masked. The `*_ready`
 * and `*_active_*` fields are read-only status computed server-side: they answer
 * "what would actually run right now", which is not the same as what is selected. */
export interface AiSettingsResponse {
  llm_provider: string;
  gemini_model: string;
  orthoepy_enabled: boolean;
  known_gemini_models: KnownModel[];
  azure_openai_endpoint: string;
  azure_openai_deployment: string;
  azure_openai_api_version: string;
  gemini_api_key: SecretState;
  azure_openai_api_key: SecretState;
  azure_ready: boolean;
  active_provider: string;
  stt_provider: string;
  azure_speech_region: string;
  whisper_model: string;
  /** The model the OpenAI grader names in its request body. Ignored when Azure
   * OpenAI is fully configured — Azure addresses a deployment instead. */
  openai_grader_model: string;
  azure_speech_key: SecretState;
  openai_api_key: SecretState;
  azure_speech_ready: boolean;
  stt_active_provider: string;
  /** The order the backends are tried in, comma-joined. The first one that is
   * configured AND answers serves the request; an unconfigured backend is skipped
   * silently and costs nothing. Always the EFFECTIVE order — a cleared setting
   * comes back as the server's default chain, never as "". */
  grader_chain: string;
  stt_chain: string;
  /** Every implemented backend, in the server's default order — the pool the chain
   * is assembled from. */
  grader_backends: string[];
  stt_backends: string[];
  /** The subset that actually holds a key. Everything else in the chain is dead
   * weight, and the panel says so rather than implying it serves traffic. */
  ready_grader_backends: string[];
  ready_stt_backends: string[];
  anthropic_api_key: SecretState;
  anthropic_model: string;
  known_anthropic_models: KnownModel[];
  /** Suggestion lists, never whitelists — the model fields take any id typed into
   * them, because a model released next month has to be usable without a deploy.
   *
   * Two spellings for the OpenAI one because the server's snake_case policy splits
   * `KnownOpenAiModels` into `known_open_ai_models` while `OpenaiApiKey` right next
   * to it becomes `openai_api_key`: same vendor, different C# casing, different
   * wire name. Accepting both means a property rename on the server costs the panel
   * its suggestion chips silently — which nobody would notice — rather than not at
   * all. Both optional for the same reason `known_whisper_models` is read through
   * a fallback: an older API image predates them. */
  known_open_ai_models?: KnownModel[];
  known_openai_models?: KnownModel[];
  known_whisper_models?: KnownModel[];
}

/** PATCH /api/admin/ai. Tri-state: omit a field to leave it unchanged, send ""
 * to clear it back to the env default, or a value to store it. `orthoepy_enabled`
 * is a STRING on the wire ("true"/"false"), normalised server-side. */
export interface AiSettingsUpdateArgs {
  llm_provider?: string;
  gemini_model?: string;
  gemini_api_key?: string;
  orthoepy_enabled?: string;
  azure_openai_endpoint?: string;
  azure_openai_api_key?: string;
  azure_openai_deployment?: string;
  azure_openai_api_version?: string;
  stt_provider?: string;
  azure_speech_region?: string;
  whisper_model?: string;
  openai_grader_model?: string;
  azure_speech_key?: string;
  openai_api_key?: string;
  /** Comma-joined backend order. `""` clears it back to the server's default chain
   * — which is why the editor is allowed to end up empty. */
  grader_chain?: string;
  stt_chain?: string;
  anthropic_api_key?: string;
  anthropic_model?: string;
}

/** One backend's answer to "does this key actually work". */
export interface ProviderProbe {
  name: string;
  /** `"grader"` or `"stt"`. */
  kind: string;
  /** `false` means SKIPPED — nobody entered a key. A deliberate state, not a failure:
   * an unconfigured backend is passed over at no cost, which is how a fallback is
   * parked. `ok` is meaningless when this is false. */
  configured: boolean;
  ok: boolean;
  /** What the vendor said it actually served — the answer to "is my model id real". */
  model: string | null;
  /** The vendor's own message, trimmed. This is the line the admin acts on. */
  error: string | null;
  elapsed_ms: number;
}

/** POST /api/admin/settings/ai/test → one real vendor call per CONFIGURED backend.
 * A POST because it has a cost: it bills every backend it can reach. */
export interface AiProbeResponse {
  results: ProviderProbe[];
}

/** GET /api/admin/reveal/{key} → the raw value of one secret. */
export interface RevealResponse {
  key: string;
  value: string;
}

/** PATCH /api/admin/links — same tri-state rules as the AI settings. */
export interface LinksUpdateArgs {
  tg_support_url?: string;
  tg_channel_url?: string;
}

/* ── F2 · Fonema drill / minimal juftliklar (docs/01 F2, behind
 *    `phoneme_drill_enabled`) ──────────────────────────────────────────────── */

/** Why the drill cannot run. Carried as a value on a normal 200 body, never as a
 * status code: "not shipped here", "no STT key is wired" and "you have used
 * today's attempts" send a person in three different directions, and one shared
 * error state would hide which one they are in. */
export type DrillStateWire =
  | "Ready"
  | "Disabled"
  | "Unconfigured"
  | "BudgetSpent";

/** What the learner did on one attempt.
 *
 * `Twin` is the teachable failure and the reason this feature exists: it means
 * the recogniser heard the OTHER half of the pair, which for a minimal pair is a
 * precise statement about one sound — expressed as a consequence the learner can
 * act on rather than as a score. */
export type DrillOutcomeWire = "Correct" | "Twin" | "Other" | "Silent";

/** One authored minimal pair. `ipa_*` are OUR phoneme names, not the vendor's:
 * Azure returns no phoneme names for Russian, so the drill supplies them from
 * curated content and the server aligns them to Azure's positional scores. */
export interface DrillPairResponse {
  slug: string;
  contrast_ru: string;
  why_uz: string;
  level: string;
  word_a: string;
  word_b: string;
  gloss_a_uz: string;
  gloss_b_uz: string;
  ipa_a: string[];
  ipa_b: string[];
  focus_index_a: number;
  focus_index_b: number;
  attempts: number;
  correct: number;
}

/** GET /api/drills/pairs → the hub grid plus whether speaking is possible now. */
export interface DrillCatalogResponse {
  state: DrillStateWire;
  pairs: DrillPairResponse[];
  daily_left: number;
}

/** One sound of the target word. `score` is null when Azure said nothing about
 * that position. */
export interface DrillPhonemeResponse {
  ipa: string;
  score: number | null;
  /** The one sound the pair is about — what the UI highlights. */
  focus: boolean;
}

/** POST /api/drills/attempts → the verdict.
 *
 * `heard_text` is verbatim from the UNSCRIPTED recognition pass and is the
 * evidence behind `outcome`. `phonemes` is DECORATION and is routinely EMPTY —
 * the server drops it whenever Azure returned no detail, the vendor failed, or
 * our IPA spelling disagreed with Azure's segmentation. A caller must render a
 * complete result without it and must never treat `[]` as an error. */
export interface DrillResultResponse {
  state: DrillStateWire;
  outcome: DrillOutcomeWire;
  target_word: string;
  heard_text: string | null;
  /** The twin they said instead — set only when `outcome === "Twin"`. */
  heard_word: string | null;
  accuracy: number | null;
  phonemes: DrillPhonemeResponse[];
  daily_left: number;
}

/* ── Billing (BillingContracts.cs — docs/08 Faza 6.6) ─────────────────────── */

/** One tariff.
 *
 * `price_minor` is the price in MINOR units — TIYIN, a whole number, never so'm and never a
 * float. Both Uzbek payment providers speak minor units on the wire, and money is the one
 * number where a rounding error is unacceptable, so the ÷100 happens once at display time
 * (`shared/money`). Never do arithmetic on a converted copy of it. */
export interface PlanResponse {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_minor: number;
  currency: string;
  duration_days: number;
  is_active: boolean;
  sort_order: number;
}

/** POST/PATCH /api/admin/billing/plans — partial on update; an omitted field is left alone. */
export interface PlanUpsertArgs {
  code?: string;
  name?: string;
  description?: string;
  price_minor?: number;
  /** Travels WITH `price_minor`, the same way it does on {@link PlanResponse} — the display
   * formatter reads it rather than assuming so'm, so a plan created without it can never be
   * formatted right afterwards. `PlanUpsertRequest.Currency` has accepted it since the tariff
   * editor shipped; this mirror simply did not declare it, which meant the panel could read a
   * plan's currency and never change it. Found by `npm run check:contract`. */
  currency?: string;
  duration_days?: number;
  is_active?: boolean;
  sort_order?: number;
}

/** Where the caller's premium comes from. `teacher` — granted by their teacher (does not
 *  lapse); `subscription` — paid for; `none` — neither. */
export type PremiumSourceWire = "teacher" | "subscription" | "none";

/** GET /api/billing/subscription — the caller's billing state in one read.
 *
 * `is_premium` is resolved from the SAME rule the 402 paywall uses (a teacher grant OR an
 * active subscription), so this screen can never claim access the gate will refuse.
 *
 * The two flags at the end are separate on purpose: `payments_enabled` is the admin switch and
 * `provider_configured` is whether an adapter exists at all. They fail for different reasons
 * and have different fixes, and a UI that collapses them sends the operator to the wrong one. */
export interface SubscriptionStatusResponse {
  is_premium: boolean;
  source: PremiumSourceWire;
  /** The subscription row's status (`pending` · `active` · `expired` · `cancelled`), or
   *  `"none"` when there has never been one. */
  status: string;
  plan: PlanResponse | null;
  starts_at: string | null;
  ends_at: string | null;
  payments_enabled: boolean;
  provider_configured: boolean;
  provider: string;
}

/** POST /api/billing/checkout.
 *
 * `idempotency_key` must be minted ONCE PER PURCHASE ATTEMPT and resent verbatim by every
 * retry — that is the only thing that makes the server's de-duplication do anything. A key
 * generated per REQUEST protects nobody from a double charge. */
export interface CheckoutArgs {
  plan_id: string;
  idempotency_key?: string;
}

/** The result of a purchase attempt. `status` is the intent's state — while no provider is
 *  configured it is `failed`, never `succeeded`. `reason` is a MACHINE CODE
 *  (`provider_not_configured`, `payments_disabled`) the client translates. */
export interface CheckoutResponse {
  intent_id: string;
  status: string;
  provider: string;
  amount_minor: number;
  currency: string;
  reason: string | null;
  redirect_url: string | null;
}

/** GET /api/admin/billing/subscriptions — one row of the admin's read-only view.
 *  `teacher_granted` is the OTHER premium source, shown beside this one because the two are
 *  independent and revoking either leaves the other in place. */
export interface AdminSubscriptionResponse {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string | null;
  plan_code: string;
  plan_name: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  provider: string | null;
  teacher_granted: boolean;
}
