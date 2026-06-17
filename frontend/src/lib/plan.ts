import type { User } from "./types";

/** Free speaking attempts before premium is required (mirrors backend FREE_ATTEMPT_LIMIT). */
export const FREE_ATTEMPT_LIMIT = 3;

/** Google OAuth Web Client ID, injected at build time. Empty → Google sign-in hidden. */
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";

/** Remaining free attempts for a student given how many they've already used. */
export function freeAttemptsLeft(user: User | null, used: number): number {
  if (!user || user.role !== "student" || user.is_premium) return Infinity;
  return Math.max(0, FREE_ATTEMPT_LIMIT - used);
}

/** Whether the student has hit the free limit and must upgrade. */
export function isLocked(user: User | null, used: number): boolean {
  return freeAttemptsLeft(user, used) <= 0;
}
