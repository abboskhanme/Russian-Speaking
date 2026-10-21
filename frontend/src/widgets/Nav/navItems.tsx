import type { TFunction } from "i18next";
import type { NavItem } from "./Nav";
import {
  AuditIcon,
  ContentIcon,
  GroupsIcon,
  HomeIcon,
  MicIcon,
  PracticeIcon,
  ProfileIcon,
  ProgressIcon,
  QueueIcon,
  SettingsIcon,
  TariffIcon,
  TeachersIcon,
} from "./icons";

/** Stable keys for the 5 student destinations (docs/03 §3.8, §4.8). */
export type StudentNavKey =
  | "home"
  | "practice"
  | "chat"
  | "progress"
  | "profile";

/**
 * The 5-item student nav model: Bosh · Mashq · AI Suhbat · Progress · Profil.
 *
 * A factory rather than a constant so the labels flow through i18n: pass the
 * `t` from `useTranslation()` and each item's `label` resolves `t("nav.<key>")`
 * in the active language (uz · ru · en). Icons are wired; the consumer supplies
 * `activeKey` + `onNavigate`. AI Suhbat is `emphasized` so it becomes the raised
 * centre FAB on the mobile bottom bar.
 */
export function studentNavItems(t: TFunction): NavItem[] {
  return [
    { key: "home", label: t("nav.home"), icon: <HomeIcon /> },
    { key: "practice", label: t("nav.practice"), icon: <PracticeIcon /> },
    {
      key: "chat",
      label: t("nav.chat"),
      icon: <MicIcon />,
      emphasized: true,
    },
    { key: "progress", label: t("nav.progress"), icon: <ProgressIcon /> },
    { key: "profile", label: t("nav.profile"), icon: <ProfileIcon /> },
  ];
}

/** Stable keys for the 5 teacher destinations, taken from the teacher mockup's
 * bottom bar (`Govorim - Teacher.dc.html`). */
export type TeacherNavKey =
  | "home"
  | "classes"
  | "queue"
  | "content"
  | "analytics";

/**
 * The teacher nav model: **Bosh · Klasslar · Navbat · Kontent · Analitika**.
 *
 * The teacher panel is its own product, not a re-skin of the student one — this
 * is the mockup's own bar, NOT {@link studentNavItems} with different labels.
 * Two consequences worth stating: there is **no Profil item** (the Obzor header
 * avatar is the profile entry), and the raised centre FAB is **Navbat** — the
 * grading queue — where the student bar puts the mic. Only the factory *shape*
 * is shared (labels via `t("nav.<key>")`, `activeKey` + `onNavigate` supplied by
 * the consumer) so both drop into `AppShell`.
 *
 * @param pendingReviews attempts waiting in the queue. When > 0 it rides the FAB
 * as a badge, exactly like the mockup's red count.
 */
export function teacherNavItems(t: TFunction, pendingReviews = 0): NavItem[] {
  return [
    { key: "home", label: t("nav.teacherHome"), icon: <HomeIcon /> },
    { key: "classes", label: t("nav.classes"), icon: <GroupsIcon /> },
    {
      key: "queue",
      label: t("nav.queue"),
      icon: <QueueIcon />,
      emphasized: true,
      badge: pendingReviews > 0 ? pendingReviews : undefined,
    },
    { key: "content", label: t("nav.content"), icon: <ContentIcon /> },
    { key: "analytics", label: t("nav.analytics"), icon: <ProgressIcon /> },
  ];
}

/** Stable keys for the admin destinations (`Govorim - Admin.dc.html`, plus Tariflar
 *  from Faza 6.6). */
export type AdminNavKey =
  | "home"
  | "teachers"
  | "students"
  | "content"
  | "billing"
  | "settings"
  | "audit";

/**
 * The admin nav model: **Boshqaruv · O'qituvchilar · O'quvchilar · Kontent · Tariflar ·
 * Sozlamalar**.
 *
 * Six bar items — plus **Jurnal** (the audit trail), which only the sidebar shows; see
 * the item below — and **no raised centre FAB**, unlike the other two bars. That is a
 * judgement, not an oversight: the student's FAB is "record", the teacher's is
 * "grade the queue" — each panel has one dominant, repeated action. Administration
 * has no such action; promoting one of these would invent an emphasis the work does
 * not have.
 *
 * **Kontent** is the mockup's "Modul, vazifa va ssenariylar": the official catalog.
 * No starter content ships, so on a fresh install this is where every module a
 * student will ever see gets written.
 *
 * Six labels do not fit a 390px bottom bar at full length in Uzbek, so the two
 * longest carry a `shortLabel` the bottom bar uses; the sidebar keeps the full word.
 *
 * There is no Profil item either — an admin manages other people's accounts here;
 * their own account opens from the header avatar (`/admin/profile`).
 */
export function adminNavItems(t: TFunction): NavItem[] {
  return [
    {
      key: "home",
      label: t("nav.adminHome"),
      shortLabel: t("nav.adminHomeShort"),
      icon: <HomeIcon />,
    },
    {
      key: "teachers",
      label: t("nav.adminTeachers"),
      shortLabel: t("nav.adminTeachersShort"),
      icon: <TeachersIcon />,
    },
    { key: "students", label: t("nav.adminStudents"), icon: <GroupsIcon /> },
    { key: "content", label: t("nav.content"), icon: <ContentIcon /> },
    // Tariflar sits before Sozlamalar because it is a place with content, and
    // Sozlamalar is the drawer everything configuration-shaped ends up in — a nav
    // bar reads better when the settings item stays last.
    { key: "billing", label: t("nav.adminBilling"), icon: <TariffIcon /> },
    // Jurnal — who did what in this panel. SIDEBAR ONLY: a seventh slot does not fit a
    // 390px bar (7 × 54px items + gaps overflow it), and reading an audit trail is desk
    // work, not something done one-handed. On a phone it opens from Boshqaruv instead.
    { key: "audit", label: t("nav.adminAudit"), icon: <AuditIcon />, sidebarOnly: true },
    { key: "settings", label: t("nav.adminSettings"), icon: <SettingsIcon /> },
  ];
}
