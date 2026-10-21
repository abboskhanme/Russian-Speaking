/**
 * screens/admin — the admin's own place (`Govorim - Admin.dc.html`), NOT a
 * re-skin of the teacher panel: its own six-item nav
 * (Boshqaruv · O'qituvchilar · O'quvchilar · Kontent · Tariflar · Sozlamalar) and no
 * centre FAB, because administration has no single dominant repeated action.
 * Kontent is the one place it borrows teacher screens (see `app/contentPanel`);
 * the profile borrows `screens/profile`'s account parts, as the teacher's does.
 *
 * Presentational + prop-driven, composed from `shared/ui` + `widgets` + tokens.
 */
export { AdminDashboardScreen, default as AdminDashboardDemo } from "./AdminDashboardScreen";
export type { AdminStats, AdminDashboardProps } from "./AdminDashboardScreen";

export { AdminPeopleScreen, default as AdminPeopleDemo } from "./AdminPeopleScreen";
export type { AdminPerson, AdminPeopleProps, AdminStaffTab } from "./AdminPeopleScreen";
export type { AdminAccount } from "./AdminAccountsList";
export type {
  AdminGroupTransferApi,
  AdminTeacherGroup,
  AdminTransferTarget,
} from "./GroupTransfer";

export { AdminProfileScreen, default as AdminProfileDemo } from "./AdminProfileScreen";
export type { AdminProfileProps, AdminProfileTabKey } from "./AdminProfileScreen";

export { AdminBillingScreen, default as AdminBillingDemo } from "./AdminBillingScreen";
export type {
  AdminPlan,
  AdminPlanDraft,
  AdminBillingProps,
  AdminSubscriptionRow,
} from "./AdminBillingScreen";

export {
  AdminAuditScreen,
  EMPTY_AUDIT_FILTERS,
  default as AdminAuditDemo,
} from "./AdminAuditScreen";
export type { AdminAuditEntry, AdminAuditFilters, AdminAuditProps } from "./AdminAuditScreen";

export { AdminSettingsScreen, default as AdminSettingsDemo } from "./AdminSettingsScreen";
export type {
  AdminSettings,
  AdminSettingsProps,
  AdminSettingsPatch,
  AdminSecret,
} from "./AdminSettingsScreen";
export { AiBudgetCard } from "./AiBudgetCard";
export type { AdminAiBudget, AdminAiBudgetPatch, AdminAiSpendLine } from "./AiBudgetCard";

export { mockAdminStats, mockAdminTeachers, mockAdminStudents, mockAdminSettings } from "./admin.mock";
