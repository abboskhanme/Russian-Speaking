import type {
  TeacherActivity,
  TeacherGroup,
  TeacherProfile,
  TeacherStats,
} from "./TeacherDashboardScreen";

/**
 * Fixture for the teacher dashboard — lets it render standalone (the default
 * export uses this) and gives the architect a shape reference. Presentational
 * only; nothing here calls a backend. Copy mirrors the RussianDesign teacher
 * mockup (Kechki-3 / Ertalabki-1 groups, the review queue).
 */

export const mockTeacher: TeacherProfile = {
  name: "Nodira",
  greeting: "Xayrli tong,",
};

export const mockTeacherStats: TeacherStats = {
  activeStudents: 54,
  groups: 3,
  pendingReviews: 3,
};

export const mockTeacherGroups: TeacherGroup[] = [
  {
    id: "grp-kechki-3",
    name: "Kechki-3",
    level: "B1",
    memberCount: 18,
    avgBand: "B1",
    joinCode: "KECHKI-3",
    schedule: "Du·Chor·Ju 18:00",
  },
  {
    id: "grp-ertalabki-1",
    name: "Ertalabki-1",
    level: "A2",
    memberCount: 21,
    avgBand: "A2",
    joinCode: "ERTALABKI-1",
    schedule: "Se·Pa·Sh 09:00",
  },
  {
    id: "grp-individual",
    name: "Individual",
    level: "B2",
    memberCount: 15,
    avgBand: "B2",
    joinCode: "INDIV-2",
    schedule: "Moslashuvchan",
  },
];

export const mockTeacherActivity: TeacherActivity[] = [
  {
    id: "act-1",
    kind: "review",
    studentName: "Dilfuza R.",
    initials: "DR",
    task: "Do'konda xarid",
    band: "A2",
    score: 58,
    flag: "low-confidence",
    when: "Bugun",
  },
  {
    id: "act-2",
    kind: "review",
    studentName: "Bekzod M.",
    initials: "BM",
    task: "O'zingni tanishtir",
    band: "B1",
    score: 71,
    flag: "flagged",
    when: "1 soat oldin",
  },
  {
    id: "act-3",
    kind: "score",
    studentName: "Kamola A.",
    initials: "KA",
    task: "Telefon suhbati",
    band: "B1",
    score: 84,
    when: "Kecha",
  },
  {
    id: "act-4",
    kind: "score",
    studentName: "Sardor U.",
    initials: "SU",
    task: "Yo'l so'rash",
    band: "A1",
    score: 55,
    when: "Kecha",
  },
];
