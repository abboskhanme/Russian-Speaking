/**
 * app/adapters — pure snake_case-API → screen-prop mappers (docs/08 auth slice,
 * priority #5). No React, no i18n (labels that need `t` are built in the pages);
 * these just reshape the wire DTOs into the presentational screens' contracts.
 */
import type {
  LeaderboardEntryResponse,
  StudentModuleResponse,
  StudentTaskResponse,
} from "../shared/api";
import type { ModuleStatus } from "../screens/home";

/** "Aziz Karimov" → "Aziz" (the warm first-name greeting). */
export function firstName(fullName: string): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

export function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function moduleProgressPct(m: StudentModuleResponse): number {
  return m.total > 0 ? clampPct((m.done_count / m.total) * 100) : 0;
}

/** Map a module's completion + lock state to the HomeScreen's status enum. */
export function moduleStatus(m: StudentModuleResponse): ModuleStatus {
  if (m.total > 0 && m.done_count >= m.total) return "done";
  // No actionable task means the module is blocked (sequence / freemium gate).
  if (m.next_task_id === null) return "locked";
  if (m.done_count > 0) return "in-progress";
  return "not-started";
}

export interface PracticeTarget {
  module: StudentModuleResponse;
  task: StudentTaskResponse;
  /** 1-based index of this task within its module (for progress pips). */
  index: number;
}

/**
 * Resolve which task Practice should present: the one matching `taskId` when
 * given (Home "Continue"/module-open passes `next_task_id`), else the first
 * actionable task across all modules (a `next_task_id` that is not locked).
 * Returns null when nothing is reachable (empty/all-locked catalogue).
 */
export function pickPracticeTarget(
  modules: StudentModuleResponse[],
  taskId?: string | null,
): PracticeTarget | null {
  if (taskId) {
    for (const m of modules) {
      const idx = m.tasks.findIndex((tk) => tk.id === taskId);
      if (idx >= 0) return { module: m, task: m.tasks[idx], index: idx + 1 };
    }
  }
  for (const m of modules) {
    if (!m.next_task_id) continue;
    const idx = m.tasks.findIndex((tk) => tk.id === m.next_task_id);
    if (idx >= 0) return { module: m, task: m.tasks[idx], index: idx + 1 };
  }
  return null;
}

/** The current user's own leaderboard row (real XP + streak), or null. */
export function myLeaderboardRow(
  rows: LeaderboardEntryResponse[],
): LeaderboardEntryResponse | null {
  return rows.find((r) => r.is_me) ?? null;
}
