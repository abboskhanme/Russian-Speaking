import type {
  AppLanguage,
  ProfilePremium,
  ProfileSettings,
  ProfileUser,
} from "./ProfileScreen";

/**
 * Fixture for the Profile screen — lets it render standalone (the default
 * export uses this) and gives the architect a shape reference. Presentational
 * only; nothing here calls a backend.
 */

export const mockProfileUser: ProfileUser = {
  name: "Aziz Karimov",
  email: "aziz.karimov@gmail.com",
  level: "A2",
  levelLabel: "boshlang'ich",
  verified: true,
};

export const mockPremium: ProfilePremium = {
  active: false,
  attemptsLeft: 3,
};

export const mockLanguage: AppLanguage = "uz";

export const mockSettings: ProfileSettings = {
  dailyGoalMinutes: 5,
  notifications: true,
};
