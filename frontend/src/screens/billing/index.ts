/**
 * screens/billing — the student's subscription place (docs/08 Faza 6.6).
 *
 * Presentational + prop-driven, composed from `shared/ui` + `widgets` + tokens. The screen owns
 * one rule of its own: a purchase is offered only when the server reports BOTH gates open
 * (`payments_enabled` and a configured provider). While either is shut it states that plainly
 * instead of showing a button that cannot work.
 */
export { PremiumScreen, default as PremiumDemo } from "./PremiumScreen";
export type {
  PremiumScreenProps,
  PremiumPlan,
  PremiumStatus,
  PremiumSource,
} from "./PremiumScreen";

export { mockPremiumPlans, mockPremiumStatus } from "./billing.mock";
