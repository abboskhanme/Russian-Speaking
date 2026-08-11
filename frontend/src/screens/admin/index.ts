/**
 * screens/admin — the admin's own place (`Govorim - Admin.dc.html`), NOT a
 * re-skin of the teacher panel: its own four-item nav
 * (Boshqaruv · O'qituvchilar · O'quvchilar · Sozlamalar) and no centre FAB,
 * because administration has no single dominant repeated action.
 *
 * Presentational + prop-driven, composed from `shared/ui` + `widgets` + tokens.
 */
export { AdminDashboardScreen, default as AdminDashboardDemo } from "./AdminDashboardScreen";
export type { AdminStats, AdminDashboardProps } from "./AdminDashboardScreen";

export { AdminPeopleScreen, default as AdminPeopleDemo } from "./AdminPeopleScreen";
export type { AdminPerson, AdminPeopleProps } from "./AdminPeopleScreen";

export { AdminSettingsScreen, default as AdminSettingsDemo } from "./AdminSettingsScreen";
export type {
  AdminSettings,
  AdminSettingsProps,
  AdminSettingsPatch,
  AdminSecret,
} from "./AdminSettingsScreen";

export { mockAdminStats, mockAdminTeachers, mockAdminStudents, mockAdminSettings } from "./admin.mock";
