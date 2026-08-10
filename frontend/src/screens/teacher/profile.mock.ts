import type { TeacherProfileProps } from "./TeacherProfileScreen";

/**
 * Fixture for the teacher profile — lets the screen render standalone. There is
 * NO mockup panel for this screen (`Govorim - Teacher.dc.html` has no profile
 * board), so these values follow the rest of the teacher fixtures rather than a
 * design source. Nothing the app fetches reads this.
 */
export const mockTeacherProfile: TeacherProfileProps = {
  user: {
    name: "Aziz Karimov",
    phone: "+998901112201",
    region: "Toshkent shahri",
    district: "Chilonzor tumani",
    // A teacher has no CEFR band; the row is hidden rather than left empty.
    level: null,
    levelLabel: null,
    registeredAt: "2026-03-14T09:00:00Z",
    verified: true,
  },
  groups: [
    { id: "g-1", name: "B1 · Kechki-3", memberCount: 18 },
    { id: "g-2", name: "A2 · Ertalabki-1", memberCount: 21 },
  ],
  language: "uz",
  theme: "light",
  notifications: true,
  links: null,
  queuedCount: 3,
};
