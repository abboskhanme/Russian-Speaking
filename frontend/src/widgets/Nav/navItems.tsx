import type { TFunction } from "i18next";
import type { NavItem } from "./Nav";
import {
  ContentIcon,
  GroupsIcon,
  HomeIcon,
  MicIcon,
  PracticeIcon,
  ProfileIcon,
  ProgressIcon,
  QueueIcon,
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
