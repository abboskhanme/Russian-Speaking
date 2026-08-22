/**
 * e2e/people — who the teacher journey signs in as, resolved rather than configured.
 *
 * The Navbat journey needs a teacher with attempts actually waiting in their
 * grading queue, and that is not a stable property of any one seeded account:
 * the queue is whatever the demo data has left ungraded, every run consumes one,
 * and `teacher@govori.uz` — the obvious pick by name — owns no groups at all, so
 * its queue is permanently empty. An `E2E_TEACHER_ID` variable would therefore
 * be a fourth thing to keep correct, and its failure mode is the worst kind: the
 * journey passes while asserting nothing, because "the queue shrank from 0 to 0"
 * is not a statement anyone reads carefully.
 *
 * So the teacher is CHOSEN, through the admin API plus a minted token per
 * candidate: whoever has the deepest queue right now. That also means the
 * journey degrades gracefully as the demo data is worked through, and states
 * plainly when there is nothing left to grade.
 */
import type { APIRequestContext } from "@playwright/test";
import { adminId, mintAccessToken, teacherIdOverride } from "./auth";

export interface Teacher {
  id: string;
  name: string;
  /** Attempts graded by AI and awaiting a teacher's sign-off, at pick time. */
  queueLength: number;
}

interface AdminTeacherRow {
  id: string;
  full_name: string;
}

export const bearer = (userId: string) => ({
  Authorization: `Bearer ${mintAccessToken(userId)}`,
});

/** Length of one teacher's review queue, straight from the API. */
export async function queueLength(request: APIRequestContext, teacherId: string): Promise<number> {
  const res = await request.get("/api/submissions?needs_review=true&limit=200", {
    headers: bearer(teacherId),
  });
  if (!res.ok()) return 0;
  return ((await res.json()) as unknown[]).length;
}

let cached: Teacher | null = null;

/**
 * The teacher with the most work waiting. Cached for the run — every step of the
 * journey must be about the SAME teacher, or "the queue went down by one" is
 * comparing two different people's queues.
 */
export async function busiestTeacher(request: APIRequestContext): Promise<Teacher> {
  if (cached) return cached;

  const override = teacherIdOverride();
  if (override) {
    cached = {
      id: override,
      name: "(E2E_TEACHER_ID)",
      queueLength: await queueLength(request, override),
    };
    return cached;
  }

  const res = await request.get("/api/admin/teachers", { headers: bearer(adminId()) });
  if (!res.ok()) {
    throw new Error(
      `GET /api/admin/teachers returned HTTP ${res.status()}. E2E_ADMIN_ID must be an admin ` +
        "in this database — the teacher journey resolves its own teacher through it.",
    );
  }
  const teachers = (await res.json()) as AdminTeacherRow[];
  if (teachers.length === 0) throw new Error("This database has no teachers to run the journey as.");

  // Sequential on purpose: one token per teacher against a dev API, and a burst
  // of parallel requests here would be the test suite's own load spike.
  const scored: Teacher[] = [];
  for (const t of teachers) {
    scored.push({ id: t.id, name: t.full_name, queueLength: await queueLength(request, t.id) });
  }
  scored.sort((a, b) => b.queueLength - a.queueLength);

  cached = scored[0];
  return cached;
}
