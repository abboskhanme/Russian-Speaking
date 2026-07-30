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

/** ClassesScreen — A2 Guruhlar + A4 O'quvchilar as one tabbed screen. */
export { ClassesScreen, default as ClassesDemo } from "./ClassesScreen";
export type {
  ClassesScreenProps,
  ClassesTabKey,
  ClassGroup,
  ClassJoinRequest,
  ClassStudent,
} from "./ClassesScreen";
export { mockClassGroups, mockClassRequests, mockClassStudents } from "./classes.mock";

/** A5 «Guruh detali». */
export {
  TeacherGroupDetailScreen,
  default as TeacherGroupDetailDemo,
} from "./TeacherGroupDetailScreen";
export type {
  TeacherGroupDetailProps,
  GroupActiveAssignment,
  GroupRosterStudent,
} from "./TeacherGroupDetailScreen";

/** A7 «A'zo qo'shish · havola + kod». */
export { GroupInviteScreen, default as GroupInviteDemo } from "./GroupInviteScreen";
export type { GroupInviteProps, InvitePendingStudent } from "./GroupInviteScreen";

/** A6 «O'quvchi profili». */
export {
  TeacherStudentProfileScreen,
  default as TeacherStudentProfileDemo,
} from "./TeacherStudentProfileScreen";
export type {
  TeacherStudentProfileProps,
  StudentSkill,
  StudentAttempt,
} from "./TeacherStudentProfileScreen";

export { mockGroupDetail, mockGroupInvite, mockStudentProfile } from "./classes.mock";
