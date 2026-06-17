import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useAuth } from "./auth";
import type { Submission } from "./types";

/** Day key (local) for a date string, e.g. "2026-06-11". */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Consecutive-day streak ending today (or yesterday) from submission dates. */
function computeStreak(subs: Submission[]): number {
  if (!subs.length) return 0;
  const days = new Set(subs.map((s) => dayKey(s.created_at)));
  const today = new Date();
  // Allow the streak to count if the last activity was today or yesterday.
  let cursor = new Date(today);
  if (!days.has(dayKey(cursor.toISOString()))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(dayKey(cursor.toISOString()))) return 0;
  }
  let streak = 0;
  while (days.has(dayKey(cursor.toISOString()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export interface StudentStats {
  streak: number;
  xp: number;
  doneCount: number;
  totalCount: number;
  avgBand: number | null;
  bestBand: number | null;
  submissions: Submission[];
  isLoading: boolean;
}

/**
 * Lightweight student stats derived from real submissions — no extra backend.
 * Powers the streak badge and progress widgets. Disabled for non-students.
 */
export function useStudentStats(): StudentStats {
  const { user } = useAuth();
  const enabled = user?.role === "student";

  const { data, isLoading } = useQuery({
    queryKey: ["my-submissions"],
    enabled,
    queryFn: async () => (await api.get<Submission[]>("/submissions")).data,
    staleTime: 30_000,
  });

  const subs = data ?? [];
  const bands = subs
    .filter((s) => s.status === "done" && s.evaluation)
    .map((s) => s.evaluation!.overall_band);
  // Streak/XP are tracked server-side (supports freezes); fall back to a
  // client estimate only if the server value is missing.
  const streak = user?.current_streak ?? computeStreak(subs);
  return {
    streak,
    xp: user?.xp ?? 0,
    doneCount: subs.filter((s) => s.status === "done").length,
    totalCount: subs.length,
    avgBand: bands.length ? bands.reduce((a, b) => a + b, 0) / bands.length : null,
    bestBand: bands.length ? Math.max(...bands) : null,
    submissions: subs,
    isLoading: enabled && isLoading,
  };
}
