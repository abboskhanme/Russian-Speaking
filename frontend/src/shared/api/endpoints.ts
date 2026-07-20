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
  AuthConfigResponse,
  EmailCodeSentResponse,
  EmailVerifyTokenResponse,
  LeaderboardEntryResponse,
  MeResponse,
  RegisterPayload,
  StudentModuleResponse,
  SubmissionResponse,
  TokenResponse,
} from "./types";

/* ── Auth ────────────────────────────────────────────────────────────────── */

export function login(email: string, password: string): Promise<TokenResponse> {
  return apiClient.post<TokenResponse>(
    "/auth/login",
    { email, password },
    { auth: false, skipAuthRedirect: true },
  );
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

/* ── Registration (OTP flow) ───────────────────────────────────────────── */

export function requestEmailCode(email: string): Promise<EmailCodeSentResponse> {
  return apiClient.post<EmailCodeSentResponse>(
    "/auth/email/request-code",
    { email },
    { auth: false, skipAuthRedirect: true },
  );
}

export function verifyEmailCode(email: string, code: string): Promise<EmailVerifyTokenResponse> {
  return apiClient.post<EmailVerifyTokenResponse>(
    "/auth/email/verify-code",
    { email, code },
    { auth: false, skipAuthRedirect: true },
  );
}

export function register(payload: RegisterPayload): Promise<MeResponse> {
  return apiClient.post<MeResponse>("/auth/register", payload, {
    auth: false,
    skipAuthRedirect: true,
  });
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

/* ── Engagement — Progress ─────────────────────────────────────────────── */

/** GET /api/leaderboard (?period). Param-free returns the all-time board; we
 * read the current user's row (`is_me`) for their real XP + streak. */
export function leaderboard(period?: string): Promise<LeaderboardEntryResponse[]> {
  const qs = period ? `?period=${encodeURIComponent(period)}` : "";
  return apiClient.get<LeaderboardEntryResponse[]>(`/leaderboard${qs}`);
}
