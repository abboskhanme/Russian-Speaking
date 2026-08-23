/**
 * Mock data for the Premium screen's demo host (docs/08 Faza 6.6).
 *
 * The default status is the one production is actually in today: no premium, both gates shut.
 * A mock that showed a purchasable price would make the demo the one place the honest refusal
 * is missing — which is exactly the state this screen exists to render.
 *
 * Prices are in TIYIN, as they are on the wire.
 */
import type { PremiumPlan, PremiumStatus } from "./PremiumScreen";

export const mockPremiumPlans: PremiumPlan[] = [
  {
    id: "plan-monthly",
    name: "1 oylik Premium",
    description: "Barcha modullar va cheksiz mashq — bir oy davomida.",
    priceMinor: 4_990_000, // 49 900 so'm
    currency: "UZS",
    durationDays: 30,
  },
  {
    id: "plan-yearly",
    name: "1 yillik Premium",
    description: "Yillik to'lov — ikki oy tekin.",
    priceMinor: 49_900_000, // 499 000 so'm
    currency: "UZS",
    durationDays: 365,
  },
];

export const mockPremiumStatus: PremiumStatus = {
  isPremium: false,
  source: "none",
  status: "none",
  paymentsEnabled: false,
  providerConfigured: false,
};
