/**
 * screens/profile — the student's "Profil" place (docs/04 §4.9), split into
 * three inner tabs: Ma'lumot · Natijalar · Sozlamalar.
 * Presentational + prop-driven; composed from `shared/ui` + `widgets` + tokens.
 *
 *   ProfileScreen      — the controllable, prop-driven screen.
 *   ProfileScreenDemo  — a self-wired default export, renderable standalone.
 */
export { ProfileScreen, default as ProfileScreenDemo } from "./ProfileScreen";
export type {
  ProfileScreenProps,
  ProfileTabKey,
  ProfileUser,
  ProfileGroup,
  ProfileStats,
  ProfileResult,
  ProfileAchievement,
  ProfileLinks,
  AppLanguage,
} from "./ProfileScreen";
/** The payload of the Ma'lumot tab's edit dialog — the route needs it to type
 *  its `onSaveInfo` handler. */
export type { EditableInfo } from "./tabs/InfoTab";

/**
 * Shared with the TEACHER panel's own profile (plan Phase 7). An account header,
 * a set of identity rows with their two editing flows, and a settings list are
 * not student concepts — they are the same on both panels, and duplicating them
 * would guarantee the two drift. What genuinely differs is expressed as props:
 * `InfoTab`'s `showLevel` (a CEFR band is a learner's number) and `relatedBlock`
 * (a student is IN one group; a teacher OWNS several), and `SettingsTab`'s
 * `hideUpgrade` (a teacher has no learner subscription to buy).
 */
export { IdentityCard } from "./ProfileScreen";
export { InfoTab } from "./tabs/InfoTab";
export type { InfoTabProps } from "./tabs/InfoTab";
export { SettingsTab } from "./tabs/SettingsTab";
export type { SettingsTabProps, SettingsLanguage, SettingsTheme } from "./tabs/SettingsTab";
export {
  mockProfileUser,
  mockGroup,
  mockStats,
  mockResults,
  mockProfileAchievements,
  mockLinks,
} from "./profile.mock";
