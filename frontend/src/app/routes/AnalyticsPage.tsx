/**
 * AnalyticsPage (`/teacher/analytics`) — D1 «Insaytlar» + D2 «Jurnal»
 * (plan Phase 6). Two endpoints, one screen:
 *
 *   • `GET /api/reports/insights`  → the whole Insaytlar tab
 *   • `GET /api/reports/gradebook` → the Jurnal table (and its CSV export)
 *   • `GET /api/groups`            → the group filter, when there is more than one
 *   • `GET /api/submissions?needs_review` → only for the Navbat FAB badge
 *
 * Both reports take the same optional `group_id`, so the filter drives them
 * together and the CSV a teacher exports always matches the table they filtered.
 *
 * Fault-tolerant: `allSettled` throughout. A failed insights call degrades the
 * Insaytlar tab to its "no data" state while Jurnal still renders — one broken
 * aggregate must not blank the page.
 *
 * **No `Intl.DateTimeFormat` anywhere.** Chromium's reduced ICU has no Uzbek
 * calendar data (it renders `2026 M07` for `{month:"long"}` and `-2 h` for
 * relative times) while Node's full ICU hides it, so month and weekday names come
 * from `time.month*` / `time.wd*` and the weekday INDEX is computed arithmetically
 * from the date — never read out of the runtime's locale tables.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AnalyticsScreen } from "../../screens/teacher";
import type {
  AnalyticsGroupOption,
  AnalyticsInsights,
  AnalyticsTabKey,
  GradebookStudent,
} from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type {
  GradebookRowResponse,
  GroupResponse,
  InsightsResponse,
} from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useTeacherNavHandler } from "../nav";

const TABS: AnalyticsTabKey[] = ["insights", "grades"];

/** The four criteria, in the mockup's order, mapped to the keys A6 already uses.
 * Reused rather than duplicated so one skill never has two names in the panel. */
const SKILL_LABELS: [keyof InsightsResponse["skills"], string][] = [
  ["fluency", "teacher.skillFluency"],
  ["grammar", "teacher.skillGrammar"],
  ["pronunciation", "teacher.skillPronunciation"],
  ["lexical", "teacher.skillLexical"],
];

/**
 * `YYYY-MM-DD` → Monday-first weekday index 0–6, computed from the date itself.
 *
 * Parsed field-by-field into a LOCAL date: `new Date("2026-08-06")` is parsed as
 * UTC midnight, which lands on the previous day for any negative UTC offset and
 * would shift the whole week by one column.
 */
function weekdayIndex(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  // getDay(): 0 = Sunday. The mockup's axis starts at Monday (Du · Se · Ch · Pa
  // · Ju · Sh · Ya), so rotate by 6.
  return (d.getDay() + 6) % 7;
}

// Which bar is "today" is NOT decided by comparing a locally-built date string to
// the API's day keys: those keys are UTC, and Tashkent is UTC+5, so between local
// midnight and 05:00 the local date is a day ahead of every key in the window and
// NO bar would be marked. The contract already answers the question — `week` is
// exactly 7 entries ending today — so the last entry is today, by definition.

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const onNavigate = useTeacherNavHandler();
  const [params, setParams] = useSearchParams();

  const rawTab = params.get("tab");
  const tab: AnalyticsTabKey = TABS.includes(rawTab as AnalyticsTabKey)
    ? (rawTab as AnalyticsTabKey)
    : "insights";
  const groupId = params.get("group");

  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [gradebook, setGradebook] = useState<GradebookRowResponse[]>([]);
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    (async () => {
      const [g, ins, gb, q] = await Promise.allSettled([
        endpoints.teacherGroups(),
        endpoints.teacherInsights(groupId ?? undefined),
        endpoints.teacherGradebook(groupId ?? undefined),
        endpoints.teacherReviewQueue(100),
      ]);
      if (!alive) return;

      // Only the group list is load-bearing for the shell; the reports each
      // degrade to their own empty state.
      if (g.status !== "fulfilled" && gb.status !== "fulfilled" && ins.status !== "fulfilled") {
        setFailed(true);
        setLoading(false);
        return;
      }
      setGroups(g.status === "fulfilled" ? g.value : []);
      setInsights(ins.status === "fulfilled" ? ins.value : null);
      setGradebook(gb.status === "fulfilled" ? gb.value : []);
      setQueued(q.status === "fulfilled" ? q.value.length : 0);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [groupId, reloadKey]);

  const groupOptions = useMemo<AnalyticsGroupOption[]>(
    () => groups.map((g) => ({ id: g.id, name: g.name })),
    [groups],
  );

  const view = useMemo<AnalyticsInsights | null>(() => {
    if (!insights) return null;
    const lastDay = insights.week.length - 1;

    return {
      classAvg: insights.class_avg,
      // Prefer the server's own label so the teacher and the student read the
      // same CEFR bucket; fall back to the bare code.
      classLevel: insights.class_level_label ?? insights.class_level,
      trendDelta: insights.trend_delta,
      trend: insights.trend.map((p) => ({
        key: `${p.year}-${p.month}`,
        label:
          p.month >= 1 && p.month <= 12 ? t(`time.month${p.month}`) : String(p.month),
        avg: p.avg,
      })),
      activeStudents: insights.active_students,
      totalStudents: insights.total_students,
      assignmentsDone: insights.assignments_done,
      assignmentsTotal: insights.assignments_total,
      // Seconds on the wire, minutes on screen — the mockup's "312 daq".
      practiceMinutes: Math.round(insights.practice_sec_week / 60),
      reviewedWeek: insights.reviewed_week,
      skills: SKILL_LABELS.map(([key, label]) => ({
        key,
        label: t(label),
        score: insights.skills?.[key] ?? null,
      })),
      week: insights.week.map((d, i) => {
        const idx = weekdayIndex(d.date);
        return {
          key: d.date || `d${i}`,
          label: idx == null ? "" : t(`time.wd${idx + 1}`),
          attempts: d.attempts,
          today: i === lastDay,
        };
      }),
      errors: insights.errors.map((e) => ({
        type: e.type,
        // An error type the frontend has not learned yet falls through to its raw
        // key rather than to a blank row — the data stays visible either way.
        label: t(`teacher.errorType.${e.type}`, { defaultValue: e.type }),
        count: e.count,
        studentCount: e.student_count,
        share: e.share,
      })),
    };
  }, [insights, t]);

  const rows = useMemo<GradebookStudent[]>(() => {
    const mapped = gradebook.map<GradebookStudent>((r) => ({
      id: r.student_id,
      fullName: r.full_name,
      fluency: r.fluency ?? undefined,
      grammar: r.grammar ?? undefined,
      pronunciation: r.pronunciation ?? undefined,
      lexical: r.lexical ?? undefined,
      attempts: r.attempts,
      score: r.avg_band ?? undefined,
    }));
    // Scored students first (highest first), then the unscored by name — the same
    // ordering as A4, so the two lists never disagree about who is "top".
    return mapped.sort((a, b) => {
      if (a.score == null && b.score == null) return a.fullName.localeCompare(b.fullName);
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return b.score - a.score;
    });
  }, [gradebook]);

  const setTab = useCallback(
    (key: AnalyticsTabKey) => {
      const next = new URLSearchParams(params);
      if (key === "insights") next.delete("tab");
      else next.set("tab", key);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const setGroup = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params);
      if (id) next.set("group", id);
      else next.delete("group");
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  if (loading) return <PageLoading />;
  if (failed) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <AnalyticsScreen
      insights={view}
      gradebook={rows}
      activeTab={tab}
      onTabChange={setTab}
      groups={groupOptions}
      activeGroupId={groupId}
      onGroupChange={setGroup}
      activeNavKey="analytics"
      onNavigate={onNavigate}
      queuedCount={queued}
    />
  );
}
