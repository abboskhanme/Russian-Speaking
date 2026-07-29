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
export {
  mockProfileUser,
  mockGroup,
  mockStats,
  mockResults,
  mockProfileAchievements,
  mockLinks,
} from "./profile.mock";
