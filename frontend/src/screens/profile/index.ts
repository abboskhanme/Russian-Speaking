/**
 * screens/profile — the student's "Profil" place (docs/04 §4.9).
 * Presentational + prop-driven; composed from `shared/ui` + `widgets` + tokens.
 *
 *   ProfileScreen      — the controllable, prop-driven screen.
 *   ProfileScreenDemo  — a self-wired default export, renderable standalone.
 */
export { ProfileScreen, default as ProfileScreenDemo } from "./ProfileScreen";
export type {
  ProfileScreenProps,
  ProfileUser,
  ProfilePremium,
  ProfileSettings,
  ProfileSettingKey,
  AppLanguage,
} from "./ProfileScreen";
export {
  mockProfileUser,
  mockPremium,
  mockLanguage,
  mockSettings,
} from "./profile.mock";
