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
  LeaderboardEntryResponse,
  MeResponse,
  OtpRequestResponse,
  OtpVerifyResponse,
  PlacementQuestionResponse,
  PlacementResultResponse,
  PlacementSubmitResponse,
  StudentModuleResponse,
  SubmissionResponse,
  TokenResponse,
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

/** GET /api/leaderboard (?period). Param-free returns the all-time board; we
 * read the current user's row (`is_me`) for their real XP + streak. */
export function leaderboard(period?: string): Promise<LeaderboardEntryResponse[]> {
  const qs = period ? `?period=${encodeURIComponent(period)}` : "";
  return apiClient.get<LeaderboardEntryResponse[]>(`/leaderboard${qs}`);
}
