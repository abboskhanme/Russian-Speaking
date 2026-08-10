import type { ClassGroup, ClassJoinRequest, ClassStudent } from "./ClassesScreen";
import type { TeacherGroupDetailProps } from "./TeacherGroupDetailScreen";
import type { GroupInviteProps } from "./GroupInviteScreen";
import type { TeacherStudentProfileProps } from "./TeacherStudentProfileScreen";

/**
 * Fixture for the Klasslar screen — lets it render standalone (the screen's
 * default export uses this). Presentational only; nothing here calls a backend.
 * Copy is lifted from the A2 + A4 screens in
 * `RussianDesign/Govori/Govorim - Teacher.dc.html`.
 */

export const mockClassGroups: ClassGroup[] = [
  { id: "g-kechki-3", name: "Kechki-3", level: "B1", memberCount: 18, avgScore: 74, joinCode: "KECHKI-3" },
  { id: "g-ertalabki-1", name: "Ertalabki-1", level: "A2", memberCount: 21, avgScore: 48, joinCode: "ERTALABKI-1" },
  { id: "g-individual", name: "Individual", level: "B2", memberCount: 15, avgScore: 81, joinCode: "INDIV-2" },
];

export const mockClassRequests: ClassJoinRequest[] = [
  { id: "r-1", studentName: "Aziz Karimov", joinCode: "KECHKI-3", when: "2 soat oldin" },
  { id: "r-2", studentName: "Malika Yusupova", joinCode: "KECHKI-3", when: "5 soat oldin" },
  { id: "r-3", studentName: "Rustam Nazarov", joinCode: "ERTALABKI-1", when: "kecha" },
];

export const mockClassStudents: ClassStudent[] = [
  // The mockup's ↑ 84 / ↓ 61 / → 72 — plus a scored student with NO trend, since
  // under four graded answers the direction is unknown and no arrow is drawn.
  { id: "s-1", fullName: "Kamola Abdullayeva", groupName: "Kechki-3", level: "B1", score: 84, trend: 7.2 },
  { id: "s-2", fullName: "Dilfuza Rashidova", groupName: "Kechki-3", level: "A2", score: 61, trend: -9.4 },
  { id: "s-3", fullName: "Bekzod Mirzayev", groupName: "Ertalabki-1", level: "A2", score: 72, trend: 0.5 },
  { id: "s-4", fullName: "Nigora Saidova", groupName: "Kechki-3", level: "A2", score: 78 },
  { id: "s-5", fullName: "Sardor Umarov", groupName: "Ertalabki-1", level: "A1", score: 55, trend: -2.8 },
  // A member who has not answered any of this teacher's questions yet — the
  // gradebook has no row for them, so the row shows "baholanmagan", not 0.
  { id: "s-6", fullName: "Jasur Toshev", groupName: "Ertalabki-1" },
];

/* ── A5 · A6 · A7 fixtures (Phase 3) ─────────────────────────────────────── */

/** A5 «Guruh detali» — the mockup's Kechki-3. */
export const mockGroupDetail: TeacherGroupDetailProps = {
  groupName: "Kechki-3",
  level: "B1",
  memberCount: 18,
  avgScore: 74,
  pendingCount: 2,
  queuedCount: 23,
  assignments: [
    {
      id: "q-tanishtir",
      title: "O‘zingni tanishtir",
      due: "Bugun 21:00",
      dueUrgent: true,
      completed: 11,
      total: 18,
    },
  ],
  roster: [
    { id: "s-1", fullName: "Kamola Abdullayeva", level: "B1", score: 84 },
    { id: "s-2", fullName: "Dilfuza Rashidova", level: "A2", score: 61 },
    { id: "s-6", fullName: "Jasur Toshev" },
  ],
};

/** A7 «A'zo qo'shish». */
export const mockGroupInvite: GroupInviteProps = {
  groupName: "Kechki-3",
  joinCode: "KECHKI-3",
  inviteLink: "https://govorim.uz/j/KECHKI-3",
  queuedCount: 23,
  pending: [
    { id: "r-1", studentName: "Shahnoza Karimova", when: "10 daqiqa oldin" },
    { id: "r-2", studentName: "Aziz Karimov", when: "2 soat oldin" },
  ],
};

/** A6 «O'quvchi profili». */
export const mockStudentProfile: TeacherStudentProfileProps = {
  fullName: "Dilfuza Rashidova",
  meta: "Kechki-3 · A2 · qo‘shilgan mart",
  queuedCount: 23,
  skills: [
    { key: "fluency", label: "Ravonlik", score: 64 },
    { key: "grammar", label: "Grammatika", score: 52 },
    { key: "pronunciation", label: "Talaffuz", score: 71 },
    { key: "lexical", label: "Lug‘at", score: 58 },
  ],
  attempts: [
    { id: "a-1", title: "Do‘konda xarid", when: "Bugun", score: 58, reviewed: false },
    { id: "a-2", title: "Telefon suhbati", when: "Kecha", score: 64, reviewed: true },
  ],
};
