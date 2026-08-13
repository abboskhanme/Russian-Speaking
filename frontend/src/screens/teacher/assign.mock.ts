import type { AssignTaskProps } from "./AssignTaskScreen";

/**
 * Fixture for D3 «Topshiriq berish» — lets the screen render standalone. Copied
 * from the D3 panel in `docs/design/mockups/Govorim - Teacher.dc.html`; nothing
 * the app fetches reads this.
 */
export const mockAssignTask: AssignTaskProps = {
  tasks: [
    { id: "t-1", kind: "task", title: "Do‘konda xarid", subtitle: "A2 · Kundalik muloqot" },
    { id: "t-2", kind: "task", title: "O‘zingni tanishtir", subtitle: "B1 · Ishda rus tili" },
    { id: "t-3", kind: "task", title: "Telefon suhbati", subtitle: "A2" },
  ],
  modules: [
    { id: "m-1", kind: "module", title: "Kundalik muloqot", subtitle: "A1–A2 · 12 vazifa", taskCount: 12 },
    { id: "m-2", kind: "module", title: "Ishda rus tili", subtitle: "B1 · 15 vazifa", taskCount: 15 },
  ],
  groups: [
    { id: "g-1", name: "B1 · Kechki-3", memberCount: 18 },
    { id: "g-2", name: "A2 · Ertalabki-1", memberCount: 21 },
    { id: "g-3", name: "B2 · Individual", memberCount: 15 },
  ],
  initialGroupId: "g-1",
  queuedCount: 3,
};
