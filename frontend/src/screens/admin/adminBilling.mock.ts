/**
 * Mock data for the Tariflar screen's demo host (docs/08 Faza 6.6).
 *
 * Its own file rather than a block appended to `admin.mock.ts`: that file is edited by
 * everything else under `screens/admin`, and a fixture that only one screen uses does not need
 * to sit in the middle of it.
 *
 * Prices are in TIYIN, as they are on the wire — a mock that used so'm would be the one place
 * the unit changes, which is exactly how a formatting bug hides in a demo that looks right.
 */
import type { AdminPlan, AdminSubscriptionRow } from "./AdminBillingScreen";

export const mockAdminPlans: AdminPlan[] = [
  {
    id: "plan-monthly",
    code: "monthly",
    name: "1 oylik Premium",
    description: "Barcha modullar, cheksiz mashq.",
    priceMinor: 4_990_000, // 49 900 so'm
    currency: "UZS",
    durationDays: 30,
    active: true,
    sortOrder: 0,
  },
  {
    id: "plan-yearly",
    code: "yearly",
    name: "1 yillik Premium",
    description: "Ikki oy tekin — yillik to'lovda.",
    priceMinor: 49_900_000, // 499 000 so'm
    currency: "UZS",
    durationDays: 365,
    active: true,
    sortOrder: 1,
  },
  {
    id: "plan-trial",
    code: "trial-2024",
    name: "Sinov tarifi",
    description: null,
    priceMinor: 990_000,
    currency: "UZS",
    durationDays: 7,
    active: false, // retired: still referenced by old subscriptions, never sold again
    sortOrder: 2,
  },
];

export const mockAdminSubscriptions: AdminSubscriptionRow[] = [
  {
    id: "sub-1",
    userName: "Dilnoza Karimova",
    userEmail: "dilnoza@example.uz",
    planName: "1 oylik Premium",
    status: "active",
    startsAt: "2026-08-01T09:00:00Z",
    endsAt: "2026-08-31T09:00:00Z",
    provider: "payme",
    teacherGranted: false,
  },
  {
    // Both sources at once — the pair the admin screen has to show side by side, because
    // revoking one does not remove the other.
    id: "sub-2",
    userName: "Jasur Toshmatov",
    userEmail: "jasur@example.uz",
    planName: "1 yillik Premium",
    status: "active",
    startsAt: "2026-03-14T09:00:00Z",
    endsAt: "2027-03-14T09:00:00Z",
    provider: "click",
    teacherGranted: true,
  },
  {
    id: "sub-3",
    userName: "Malika Yusupova",
    userEmail: "malika@example.uz",
    planName: "Sinov tarifi",
    status: "expired",
    startsAt: "2026-06-01T09:00:00Z",
    endsAt: "2026-06-08T09:00:00Z",
    provider: "payme",
    teacherGranted: false,
  },
];
