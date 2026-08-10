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
}

/** GET /api/assignments/mine → the caller's assignments. The Home screen shows
 * the soonest incomplete one ("Keyingi topshiriq"). `question_title` is the task
 * name; `due_at` is the deadline (null = no deadline); `completed` marks done. */
/** Body of POST /api/assignments — assign one task to a group and/or explicit
 * students. `due_at` is ISO-8601 or omitted for no deadline.
 *
 * There is deliberately NO attempt limit: `assignments` has no such column and
 * nothing in the pipeline enforces one, so the mockup's "Urinish · 3 ta" control
 * would promise a rule the server does not keep. */
export interface CreateAssignmentArgs {
  question_id: string;
  group_id?: string;
  student_ids?: string[];
  due_at?: string;
}

/** Body of POST /api/assignments/module — assign a whole module's published tasks. */
export interface CreateModuleAssignmentArgs {
  block_id: string;
  group_id?: string;
  student_ids?: string[];
  due_at?: string;
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
}

/* ── Settings (SettingsContracts.cs) ─────────────────────────────────────── */

/** GET /api/settings/links → the deployment's Telegram destinations, powering
 * the "Yordam markazi" modal. Both are absolute `https://t.me/…` URLs. */
export interface LinksResponse {
  tg_support_url: string;
  tg_channel_url: string;
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
  visibility: string;
  is_published: boolean;
  sort_order: number;
  task_count: number;
  student_count: number;
  created_at: string;
  updated_at: string;
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
