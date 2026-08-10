import type { TeacherProfileProps } from "./TeacherProfileScreen";

/**
 * Fixture for the teacher profile — lets the screen render standalone. There is
 * NO mockup panel for this screen (`Govorim - Teacher.dc.html` has no profile
 * board), so these values follow the rest of the teacher fixtures rather than a
 * design source. Nothing the app fetches reads this.
 */
export const mockTeacherProfile: TeacherProfileProps = {
  identity: {
    fullName: "Aziz Karimov",
    phone: "+998 90 111 22 01",
    joined: "qo‘shilgan mart 2026",
  },
  groups: [
    { id: "g-1", name: "B1 · Kechki-3", memberCount: 18 },
    { id: "g-2", name: "A2 · Ertalabki-1", memberCount: 21 },
  ],
  language: "uz",
  queuedCount: 3,
};
