import type { ClassGroup, ClassJoinRequest, ClassStudent } from "./ClassesScreen";

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
  { id: "s-1", fullName: "Kamola Abdullayeva", groupName: "Kechki-3", level: "B1", score: 84 },
  { id: "s-2", fullName: "Dilfuza Rashidova", groupName: "Kechki-3", level: "A2", score: 61 },
  { id: "s-3", fullName: "Bekzod Mirzayev", groupName: "Ertalabki-1", level: "A2", score: 72 },
  { id: "s-4", fullName: "Nigora Saidova", groupName: "Kechki-3", level: "A2", score: 78 },
  { id: "s-5", fullName: "Sardor Umarov", groupName: "Ertalabki-1", level: "A1", score: 55 },
  // A member who has not answered any of this teacher's questions yet — the
  // gradebook has no row for them, so the row shows "baholanmagan", not 0.
  { id: "s-6", fullName: "Jasur Toshev", groupName: "Ertalabki-1" },
];
