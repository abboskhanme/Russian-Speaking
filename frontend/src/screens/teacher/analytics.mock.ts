/**
 * analytics.mock — demo fixture for `AnalyticsDemo`, the screen's self-wired
 * default export. **Development only.** Nothing in the wired app reads this:
 * `AnalyticsPage` builds every prop from `GET /api/reports/insights` and
 * `GET /api/reports/gradebook`, and renders an empty state where the server has
 * no data rather than falling back to these numbers.
 *
 * Labels are pre-localized here (uz) because the screen takes them as props —
 * the real page composes them from `time.month*` / `time.wd*` / `teacher.*`.
 */
import type { AnalyticsScreenProps } from "./AnalyticsScreen";

export const mockAnalytics: AnalyticsScreenProps = {
  insights: {
    classAvg: 72,
    classLevel: "B1",
    trendDelta: 7,
    trend: [
      { key: "2026-5", label: "may", avg: 61 },
      { key: "2026-6", label: "iyun", avg: 65 },
      { key: "2026-7", label: "iyul", avg: 72 },
    ],
    activeStudents: 41,
    totalStudents: 48,
    assignmentsDone: 78,
    assignmentsTotal: 100,
    practiceMinutes: 312,
    reviewedWeek: 94,
    skills: [
      { key: "fluency", label: "Ravonlik", score: 76 },
      { key: "grammar", label: "Grammatika", score: 58 },
      { key: "pronunciation", label: "Talaffuz", score: 69 },
      { key: "lexical", label: "Lug'at", score: 81 },
    ],
    week: [
      { key: "d1", label: "Du", attempts: 12 },
      { key: "d2", label: "Se", attempts: 16 },
      { key: "d3", label: "Ch", attempts: 10 },
      { key: "d4", label: "Pa", attempts: 20 },
      { key: "d5", label: "Ju", attempts: 14 },
      { key: "d6", label: "Sh", attempts: 8 },
      { key: "d7", label: "Ya", attempts: 6, today: true },
    ],
    errors: [
      { type: "word_order", label: "So'z tartibi", count: 24, studentCount: 12, share: 0.22 },
      { type: "grammar", label: "Grammatika", count: 19, studentCount: 9, share: 0.17 },
      { type: "vocabulary", label: "Lug'at", count: 14, studentCount: 7, share: 0.13 },
    ],
  },
  gradebook: [
    { id: "s1", fullName: "Kamola A.", fluency: 88, grammar: 80, pronunciation: 82, lexical: 85, attempts: 14, score: 84 },
    { id: "s2", fullName: "Nigora S.", fluency: 80, grammar: 74, pronunciation: 77, lexical: 79, attempts: 11, score: 78 },
    { id: "s3", fullName: "Bekzod M.", fluency: 72, grammar: 70, pronunciation: 71, lexical: 74, attempts: 9, score: 72 },
    { id: "s4", fullName: "Dilfuza R.", fluency: 64, grammar: 52, pronunciation: 60, lexical: 63, attempts: 7, score: 61 },
    { id: "s5", fullName: "Sardor U.", fluency: 52, grammar: 48, pronunciation: 50, lexical: 51, attempts: 4, score: 50 },
    { id: "s6", fullName: "Jasur T.", attempts: 0 },
  ],
  queuedCount: 21,
};
