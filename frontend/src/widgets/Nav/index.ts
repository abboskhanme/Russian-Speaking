export { Nav } from "./Nav";
export type { NavProps, NavItem, NavVariant } from "./Nav";

export {
  HomeIcon,
  PracticeIcon,
  ChatIcon,
  MicIcon,
  ProgressIcon,
  ProfileIcon,
  GroupsIcon,
  QueueIcon,
  ContentIcon,
  // Not in either nav bar — kept for the teacher's Kontent/Analitika screens
  // (mockup boards C + D) and assignment cards.
  AssignmentsIcon,
  GradebookIcon,
  SettingsIcon,
  TeachersIcon,
} from "./icons";

export { studentNavItems, teacherNavItems, adminNavItems } from "./navItems";
export type { StudentNavKey, TeacherNavKey, AdminNavKey } from "./navItems";
