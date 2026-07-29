/**
 * widgets/Notifications — the app-shell header bell and its full-window centre.
 *
 *   NotificationsBell  — the `headerEnd` button (replaces ThemeToggle, which now
 *                        lives in Profil → Sozlamalar). Self-managing: it owns
 *                        its unread count and the modal.
 *   NotificationsModal — the full-window list: select, delete selected, clear all.
 */
export { NotificationsBell } from "./NotificationsBell";
export type { NotificationsBellProps } from "./NotificationsBell";

export { NotificationsModal } from "./NotificationsModal";
export type { NotificationsModalProps } from "./NotificationsModal";
