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

/** GET /api/auth/me AND POST /api/auth/register → MeResponse. */
export interface MeResponse {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  is_premium: boolean;
}

export interface AuthConfigResponse {
  email_verification: boolean;
  google: boolean;
}

export interface EmailCodeSentResponse {
  ok: boolean;
  expires_in: number;
}

export interface EmailVerifyTokenResponse {
  email_verify_token: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  full_name: string;
  phone: string;
  age: number;
  region: string;
  district: string;
  email_verify_token?: string | null;
  group_code?: string | null;
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
