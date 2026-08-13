/**
 * screens/teacher — the teacher panel's screens, built from
 * `docs/design/mockups/Govorim - Teacher.dc.html`. Presentational +
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

/** B1 «Tekshirish navbati» — the Navbat FAB's destination. */
export { ReviewQueueScreen, default as ReviewQueueDemo, LOW_BAND } from "./ReviewQueueScreen";
export type { ReviewQueueProps, QueueItem, QueueFilter } from "./ReviewQueueScreen";

/** B2 «Javob detali» + B3 «Qo'lda baholash». */
export {
  AttemptReviewScreen,
  default as AttemptReviewDemo,
} from "./AttemptReviewScreen";
export type {
  AttemptReviewProps,
  ReviewWord,
  ReviewCriterion,
} from "./AttemptReviewScreen";

export { mockReviewQueue, mockAttemptReview } from "./queue.mock";

/** C1 «Kontent» — Modullar | Vazifalar. */
export { ContentScreen, default as ContentDemo } from "./ContentScreen";
export type {
  ContentScreenProps,
  ContentModule,
  ContentTask,
  ContentTabKey,
} from "./ContentScreen";

/** C4 «Modul yaratish» + C5 picker + C2 new-task sheet. */
export { ModuleEditorScreen, default as ModuleEditorDemo } from "./ModuleEditorScreen";
export type {
  ModuleEditorProps,
  EditorTask,
  LibraryTask,
  NewTaskDraft,
} from "./ModuleEditorScreen";

export { mockContentModules, mockContentTasks, mockModuleEditor } from "./content.mock";

/** D1 «Insaytlar» + D2 «Jurnal» as one tabbed screen. */
export { AnalyticsScreen, default as AnalyticsDemo } from "./AnalyticsScreen";
export type {
  AnalyticsScreenProps,
  AnalyticsTabKey,
  AnalyticsInsights,
  AnalyticsTrendPoint,
  AnalyticsSkill,
  AnalyticsWeekDay,
  AnalyticsErrorRow,
  AnalyticsGroupOption,
  GradebookStudent,
} from "./AnalyticsScreen";

export { mockAnalytics } from "./analytics.mock";

/** D3 «Topshiriq berish» — bulk assign, reached from the A2 / A5 assign buttons. */
export { AssignTaskScreen, default as AssignTaskDemo } from "./AssignTaskScreen";
export type {
  AssignTaskProps,
  AssignSelection,
  AssignGroupOption,
  AssignOutcome,
} from "./AssignTaskScreen";

export { mockAssignTask } from "./assign.mock";

/** Phase 7 «Profil» — the A1 header avatar's destination (there is no nav item). */
export { TeacherProfileScreen, default as TeacherProfileDemo } from "./TeacherProfileScreen";
export type {
  TeacherProfileProps,
  TeacherProfileGroup,
  TeacherProfileTabKey,
} from "./TeacherProfileScreen";

export { mockTeacherProfile } from "./profile.mock";
