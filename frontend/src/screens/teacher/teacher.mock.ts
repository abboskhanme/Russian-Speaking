import type {
  TeacherAttentionItem,
  TeacherProfile,
  TeacherStats,
} from "./TeacherDashboardScreen";

/**
 * Fixture for the teacher Obzor — lets it render standalone (the screen's
 * default export uses this) and gives the architect a shape reference.
 * Presentational only; nothing here calls a backend. Copy is lifted from the
 * A1 screen in `RussianDesign/Govori/Govorim - Teacher.dc.html`, so the demo and
 * the mockup read the same.
 */

export const mockTeacher: TeacherProfile = {
  name: "Dilnoza Karimova",
  greeting: "Xayrli tong,",
  initials: "DK",
};

export const mockTeacherStats: TeacherStats = {
  groups: 3,
  students: 54,
  queued: 3,
};

export const mockTeacherAttention: TeacherAttentionItem[] = [
  {
    id: "att-low-confidence",
    tone: "danger",
    title: "3 ta javob — AI ishonchi past",
    hint: "Tekshirish navbatiga o‘ting",
  },
  {
    id: "att-dropped",
    tone: "warn",
    title: "2 o‘quvchi 15 punkt tushdi",
    hint: "Profilni ko‘rish",
  },
  {
    id: "att-join-requests",
    tone: "accent",
    title: "3 ta guruhga qo‘shilish so‘rovi",
    hint: "Tasdiqlash kerak",
  },
];
