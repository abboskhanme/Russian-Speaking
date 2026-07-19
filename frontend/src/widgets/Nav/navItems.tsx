import type { TFunction } from "i18next";
import type { NavItem } from "./Nav";
import {
  ChatIcon,
  HomeIcon,
  PracticeIcon,
  ProfileIcon,
  ProgressIcon,
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
      icon: <ChatIcon />,
      emphasized: true,
    },
    { key: "progress", label: t("nav.progress"), icon: <ProgressIcon /> },
    { key: "profile", label: t("nav.profile"), icon: <ProfileIcon /> },
  ];
}
