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
 * Icons are wired; the consumer supplies `activeKey` + `onNavigate` (and may
 * add `href` per item once routing is wired). AI Suhbat is `emphasized` so it
 * becomes the raised centre FAB on the mobile bottom bar.
 */
export const studentNavItems: NavItem[] = [
  { key: "home", label: "Bosh", icon: <HomeIcon /> },
  { key: "practice", label: "Mashq", icon: <PracticeIcon /> },
  { key: "chat", label: "AI Suhbat", icon: <ChatIcon />, emphasized: true },
  { key: "progress", label: "Progress", icon: <ProgressIcon /> },
  { key: "profile", label: "Profil", icon: <ProfileIcon /> },
];
