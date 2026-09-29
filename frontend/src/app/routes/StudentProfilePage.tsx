/**
 * StudentProfilePage (`/teacher/students/:studentId`) — A6 «O'quvchi profili»
 * (plan Phase 3).
 *
 *   • `GET /api/submissions?student_id=…` → the attempts AND, via the AI scores
 *     now on each row, the "Ko'nikmalar" averages. One request, not one per attempt.
 *   • `GET /api/groups/{id}`  → the group name + when they joined (`?group=` hint)
 *   • `GET /api/classroom/students/{id}` → who they are, their groups, and the
 *     premium grant the switch is bound to (A6 is also opened WITHOUT `?group=`,
 *     from Klasslar and the dashboard, and then only this read names them)
 *   • `PATCH /api/classroom/students/{id}/premium` ← the switch
 *
 * Server-side scoping does the security work: `?student_id` only narrows the
 * teacher's existing roster scope, so a teacher who asks for someone else's
 * student simply gets an empty list. This page therefore treats "no attempts" as
 * a legitimate empty state rather than trying to authorize anything itself.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { TeacherStudentProfileScreen } from "../../screens/teacher";
import type { StudentAttempt, StudentSkill } from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type {
  ClassroomStudentResponse,
  GroupDetailResponse,
  SubmissionResponse,
} from "../../shared/api";
import { dateParts, relativeTime } from "../adapters";
import { PageError, PageLoading } from "../PageState";
import { TEACHER_NAV_PATH, useTeacherNavHandler } from "../nav";
import { SKILL_KEYS, averageBand, levelFromBand, skillAverages } from "../teacherAdapters";

/** Skill key → its i18n label key, in the mockup's bar order. */
const SKILL_LABEL: Record<string, string> = {
  fluency: "teacher.skillFluency",
  grammar: "teacher.skillGrammar",
  pronunciation: "teacher.skillPronunciation",
  lexical: "teacher.skillLexical",
};

export default function StudentProfilePage() {
  const { studentId = "" } = useParams();
  const [params] = useSearchParams();
  const groupId = params.get("group");
  const navigate = useNavigate();
  const { t } = useTranslation();
  const onNavigate = useTeacherNavHandler();

  const [subs, setSubs] = useState<SubmissionResponse[]>([]);
  const [group, setGroup] = useState<GroupDetailResponse | null>(null);
  const [student, setStudent] = useState<ClassroomStudentResponse | null>(null);
  /** The premium as the SERVER last reported it — flipped optimistically on a
   * write, then overwritten by the write's own response (see setPremium). */
  const [premium, setPremium] = useState<{ granted: boolean; effective: boolean } | null>(null);
  const [queued, setQueued] = useState(0);
  /** Null = no direction: under four graded answers the server does not claim one. */
  const [trend, setTrend] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    Promise.allSettled([
      endpoints.teacherStudentSubmissions(studentId, 100),
      groupId ? endpoints.teacherGroupDetail(groupId) : Promise.resolve(null),
      endpoints.teacherReviewCount(),
      // For the trend direction only. Deliberately taken from the SERVER rather
      // than recomputed from `subs` here: the newer-half-vs-older-half rule lives
      // in ClassroomScoring, and a second copy in the client would drift from the
      // arrow the roster shows for the same student.
      endpoints.teacherGradebook(),
      endpoints.classroomStudent(studentId),
    ])
      .then(([s, g, all, gb, st]) => {
        if (!alive) return;
        if (s.status !== "fulfilled") {
          setFailed(true);
          return;
        }
        setSubs(s.value);
        setGroup(g.status === "fulfilled" ? g.value : null);
        // A failed student read (404 outside the roster, or an API without the
        // route) hides the premium switch rather than drawing one that cannot save.
        const who = st.status === "fulfilled" ? st.value : null;
        setStudent(who);
        setPremium(who ? { granted: who.is_premium, effective: who.has_premium } : null);
        setQueued(
          all.status === "fulfilled"
            ? all.value.count
            : 0,
        );
        setTrend(
          gb.status === "fulfilled"
            ? (gb.value.find((r) => r.student_id === studentId)?.trend_delta ?? null)
            : null,
        );
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [studentId, groupId, reloadKey]);

  const member = useMemo(
    () => group?.members.find((m) => m.id === studentId) ?? null,
    [group, studentId],
  );

  /** The student's display name: the roster, then the student read, then any
   * submission's `student_name`. */
  const fullName =
    member?.full_name ??
    student?.full_name ??
    subs.find((s) => s.student_name)?.student_name ??
    "—";

  const meta = useMemo(() => {
    const band = averageBand(subs);
    // Without `?group=` the student read supplies the group (their first, i.e.
    // oldest membership with this teacher) and when they joined it.
    const firstGroup = student?.groups[0] ?? null;
    const joinedAt = member?.joined_at ?? firstGroup?.joined_at ?? null;
    const parts = [
      group?.name ?? firstGroup?.name,
      band != null ? levelFromBand(band) : null,
      // "qo'shilgan iyul 2026" — month name from i18n, not Intl (Chromium's
      // reduced ICU renders Uzbek months as "M07").
      joinedAt ? joinedCaption(joinedAt, t) : null,
    ].filter(Boolean);
    return parts.join(" · ");
  }, [group, member, student, subs, t]);

  /**
   * Grant/revoke. The switch moves at once (a settings control that waits on a
   * round-trip feels broken), then shows exactly what the server stored — which is
   * what the response carries, and not necessarily what was asked for. A failure
   * puts the previous value back and rethrows so the card can say it.
   */
  const changePremium = useCallback(
    async (next: boolean) => {
      const before = premium;
      setPremium((p) => (p ? { ...p, granted: next } : p));
      try {
        const res = await endpoints.setStudentPremium(studentId, next);
        setPremium({ granted: res.is_premium, effective: res.has_premium });
      } catch (e) {
        setPremium(before);
        throw e;
      }
    },
    [premium, studentId],
  );

  const skills = useMemo<StudentSkill[]>(() => {
    const avgs = skillAverages(subs);
    // Only the skills with at least one score — an absent bar means "never
    // measured", which a 0-width bar would misreport as a score of zero.
    return SKILL_KEYS.filter((k) => avgs[k] != null).map((k) => ({
      key: k,
      label: t(SKILL_LABEL[k]),
      score: avgs[k] as number,
    }));
  }, [subs, t]);

  const attempts = useMemo<StudentAttempt[]>(
    () =>
      subs.slice(0, 20).map((s) => {
        const rel = relativeTime(s.created_at);
        return {
          id: s.id,
          title: s.question_title ?? "—",
          when: t(rel.key, { count: rel.count }),
          score: s.overall_band ?? undefined,
          reviewed: s.reviewed_at !== null,
        };
      }),
    [subs, t],
  );

  if (loading) return <PageLoading />;
  if (failed) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <TeacherStudentProfileScreen
      fullName={fullName}
      meta={meta}
      skills={skills}
      attempts={attempts}
      trend={trend}
      activeNavKey="classes"
      onNavigate={onNavigate}
      queuedCount={queued}
      onBack={() =>
        navigate(
          groupId
            ? `${TEACHER_NAV_PATH.classes}/${encodeURIComponent(groupId)}`
            : `${TEACHER_NAV_PATH.classes}?tab=students`,
        )
      }
      // D3 reads `?student=` and assigns to this one student via `student_ids`.
      onAssign={() => navigate(`/teacher/assign?student=${encodeURIComponent(studentId)}`)}
      onOpenAttempt={(id) => navigate(`/teacher/queue/${encodeURIComponent(id)}`)}
      premium={premium}
      onSetPremium={changePremium}
    />
  );
}

/** "qo'shilgan iyul 2026" from a join timestamp. */
function joinedCaption(iso: string, t: TFunction): string | null {
  const p = dateParts(iso);
  if (!p) return null;
  const month = t("time.monthYear", { month: t(`time.month${p.month}`), year: p.year });
  return t("teacher.joinedAt", { month });
}
