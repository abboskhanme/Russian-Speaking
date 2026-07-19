/**
 * screens/teacher — the teacher's Boshqaruv paneli (docs/04 teacher flows,
 * Faza 4.9). Presentational + prop-driven; composed from `shared/ui` +
 * `widgets` + tokens, at compact density (docs/03 §3.5).
 *
 *   TeacherDashboardScreen — the controllable, prop-driven screen.
 *   TeacherDashboardDemo   — a self-wired default export, renderable standalone.
 */
export {
  TeacherDashboardScreen,
  default as TeacherDashboardDemo,
} from "./TeacherDashboardScreen";
export type {
  TeacherDashboardProps,
  TeacherProfile,
  TeacherStats,
  TeacherGroup,
  TeacherActivity,
  TeacherActivityKind,
  TeacherReviewFlag,
} from "./TeacherDashboardScreen";
export {
  mockTeacher,
  mockTeacherStats,
  mockTeacherGroups,
  mockTeacherActivity,
} from "./teacher.mock";
