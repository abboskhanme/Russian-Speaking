/**
 * StudentProfilePage (`/teacher/students/:studentId`) — A6 «O'quvchi profili»
 * (plan Phase 3).
 *
 *   • `GET /api/submissions?student_id=…` → the attempts AND, via the AI scores
 *     now on each row, the "Ko'nikmalar" averages. One request, not one per attempt.
 *   • `GET /api/groups/{id}`  → the group name + when they joined (`?group=` hint)
 *
 * Server-side scoping does the security work: `?student_id` only narrows the
 * teacher's existing roster scope, so a teacher who asks for someone else's
 * student simply gets an empty list. This page therefore treats "no attempts" as
 * a legitimate empty state rather than trying to authorize anything itself.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { TeacherStudentProfileScreen } from "../../screens/teacher";
import type { StudentAttempt, StudentSkill } from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type { GroupDetailResponse, SubmissionResponse } from "../../shared/api";
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
  const [queued, setQueued] = useState(0);
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
      endpoints.teacherSubmissions(),
    ])
      .then(([s, g, all]) => {
        if (!alive) return;
        if (s.status !== "fulfilled") {
          setFailed(true);
          return;
        }
        setSubs(s.value);
        setGroup(g.status === "fulfilled" ? g.value : null);
        setQueued(
          all.status === "fulfilled"
            ? all.value.filter((x) => x.status === "done" && x.reviewed_at === null).length
            : 0,
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

  /** The student's display name. The roster is the reliable source; a submission's
   * `student_name` is the fallback for a student reached without a `?group=`. */
  const fullName = member?.full_name ?? subs.find((s) => s.student_name)?.student_name ?? "—";

  const meta = useMemo(() => {
    const band = averageBand(subs);
    const parts = [
      group?.name,
      band != null ? levelFromBand(band) : null,
      // "qo'shilgan iyul 2026" — month name from i18n, not Intl (Chromium's
      // reduced ICU renders Uzbek months as "M07").
      member ? joinedCaption(member.joined_at, t) : null,
    ].filter(Boolean);
    return parts.join(" · ");
  }, [group, member, subs, t]);

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
      onAssign={() => navigate(`/teacher/assign?student=${encodeURIComponent(studentId)}`)}
      // B2 answer detail is Phase 4; until then it resolves back here.
      onOpenAttempt={(id) => navigate(`/teacher/queue/${encodeURIComponent(id)}`)}
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
