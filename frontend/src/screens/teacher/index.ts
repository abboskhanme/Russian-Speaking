/**
 * screens/teacher — the teacher panel's screens, built from
 * `RussianDesign/Govori/Govorim - Teacher.dc.html`. Presentational +
 * prop-driven; composed from `shared/ui` + `widgets` + tokens, at compact
 * density (docs/03 §3.5).
 *
 * The teacher panel is its own design with its own nav (`Bosh · Klasslar ·
 * Navbat · Kontent · Analitika`) — these are not student screens restyled.
 *
 *   TeacherDashboardScreen — A1 «Obzor», the controllable prop-driven screen.
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
  TeacherAttentionItem,
  AttentionTone,
} from "./TeacherDashboardScreen";
export { mockTeacher, mockTeacherStats, mockTeacherAttention } from "./teacher.mock";
