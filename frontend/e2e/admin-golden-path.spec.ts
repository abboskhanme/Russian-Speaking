/**
 * The admin golden path: Boshqaruv → the student roster → grant premium →
 * Sozlamalar, and save.
 *
 * NO REAL VENDOR CALLS. `/api/admin/settings/ai/test` probes Anthropic, Gemini,
 * OpenAI and Azure Speech with the live keys — every press costs money. The
 * button is never touched here, and that is not left to the author remembering:
 * the route is intercepted for the whole journey, so a call cannot escape even
 * if some future screen fires one on mount. The interception COUNTS calls too,
 * and zero is asserted at the end — a page that probes on load would be a real
 * finding (a bill for opening a screen), not something to quietly stub away.
 *
 * IDEMPOTENCE. The two mutations here are genuine writes to shared state — a
 * user's premium flag and a deployment-wide feature limit — so unlike the
 * teacher journey these ARE restored. Each is read first, flipped, verified
 * against the API, then put back and verified again. Restoring is itself the
 * strongest available assertion that the write went through: the value could
 * not come back if it had never moved.
 */
import { adminId, studentId } from "./auth";
import {
  clickNav,
  expect,
  expectNoCriticalA11y,
  expectNoRawJson,
  expectVisibleText,
  goTo,
  reportA11yTally,
  signInAs,
  test,
} from "./fixtures";
import { bearer } from "./people";

test.afterAll(() => reportA11yTally("admin golden path"));

interface AdminStats {
  teachers: number;
  students: number;
  questions: number;
  submissions: number;
}
interface AdminStudent {
  id: string;
  full_name: string;
  is_premium: boolean;
}
interface FeatureFlags {
  roleplay_max_turns: number;
  roleplay_daily_turns: number;
  review_drill_enabled: boolean;
  roleplay_enabled: boolean;
}

/** The one endpoint that spends money. Never reached from a test. */
const AI_PROBE = "**/api/admin/settings/ai/test";

test("an admin reads the dashboard, grants premium and saves a setting", async ({
  page,
  request,
}) => {
  const auth = bearer(adminId());

  let probeCalls = 0;
  await page.route(AI_PROBE, async (route) => {
    probeCalls += 1;
    // Stubbed rather than aborted: an abort surfaces as a network console error
    // and would fail the run for the wrong reason, hiding the real signal, which
    // is the counter.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await signInAs(page, adminId());

  /* ── 1. Boshqaruv ─────────────────────────────────────────────────────────
     An admin must land in the ADMIN panel. They used to be folded in with
     teachers, which meant signing in as an admin opened a dashboard about
     someone else's groups — a bug that looked like a working screen. */
  const stats = (await (await request.get("/api/admin/stats", { headers: auth })).json()) as AdminStats;

  await test.step("an admin's / resolves to the admin panel", async () => {
    await goTo(page, "/", /^\/admin$/);
    // A counter from the API, on the screen: proof the page is wired to this
    // database rather than rendering the mock fixtures it was built against.
    await expectVisibleText(page, String(stats.students));
    await expectVisibleText(page, String(stats.teachers));
    await expectNoCriticalA11y(page, "/admin (Boshqaruv)");
    await expectNoRawJson(page, "/admin (Boshqaruv)");
  });

  /* ── 2. The roster ────────────────────────────────────────────────────── */
  const students = (await (
    await request.get("/api/admin/students", { headers: auth })
  ).json()) as AdminStudent[];
  // Not the golden-path student: premium changes how many attempts they get, and
  // the student journey should not be reading a flag this journey is flipping.
  const subject = students.find((s) => s.id !== studentId() && s.full_name.trim().length > 0);
  expect(subject, "no student available to administer").toBeTruthy();
  const target = subject as AdminStudent;

  await test.step("the nav reaches the student roster", async () => {
    await clickNav(page, "O'quvchilar", /^\/admin\/students$/);
    await expectNoCriticalA11y(page, "/admin/students");
    await expectNoRawJson(page, "/admin/students");
  });

  await test.step("search narrows the roster to one student", async () => {
    await page.getByRole("searchbox").fill(target.full_name);
    await expectVisibleText(page, target.full_name);
    await expect
      .poll(() => page.getByRole("button", { name: /Boshqarish/i }).count(), {
        message: "the search box did not narrow the roster",
      })
      .toBe(1);
  });

  /* ── 3. Grant premium, and put it back ────────────────────────────────── */
  const premiumOf = async (): Promise<boolean> => {
    const rows = (await (
      await request.get(`/api/admin/students?search=${encodeURIComponent(target.full_name)}`, {
        headers: auth,
      })
    ).json()) as AdminStudent[];
    const row = rows.find((r) => r.id === target.id);
    expect(row, `${target.full_name} vanished from the roster mid-journey`).toBeTruthy();
    return (row as AdminStudent).is_premium;
  };

  const wasPremium = await premiumOf();

  await test.step("the manage sheet toggles premium, and the API agrees", async () => {
    await page.getByRole("button", { name: /Boshqarish/i }).click();
    await expectVisibleText(page, target.full_name);

    const premium = page.getByRole("switch", { name: /Premium/i });
    await expect(premium, "the manage sheet should offer one premium switch").toHaveCount(1);
    await expect(premium).toHaveAttribute("aria-checked", String(wasPremium));

    await premium.click();
    await expect
      .poll(premiumOf, { message: "the premium toggle never reached the database" })
      .toBe(!wasPremium);
    // The control must also report the new truth — a switch that writes but does
    // not repaint reads as "the click did nothing" and invites a second press.
    await expect(premium).toHaveAttribute("aria-checked", String(!wasPremium));
  });

  await test.step("premium is restored, so the run leaves nothing behind", async () => {
    await page.getByRole("switch", { name: /Premium/i }).click();
    await expect
      .poll(premiumOf, { message: `${target.full_name} was left with premium flipped` })
      .toBe(wasPremium);

    // The sheet has to be dismissed explicitly. Its scrim swallows pointer
    // events, so leaving it open turns the next nav click into a 30-second
    // "element intercepts pointer events" timeout that reads like a broken nav.
    await page.getByRole("button", { name: /Yopish/i }).click();
    await expect(page.getByRole("switch", { name: /Premium/i })).toHaveCount(0);
  });

  /* ── 4. Sozlamalar: render, then save ─────────────────────────────────── */
  await test.step("the settings screen renders without leaking a secret", async () => {
    await clickNav(page, "Sozlamalar", /^\/admin\/settings$/);
    await expectNoCriticalA11y(page, "/admin/settings");
    await expectNoRawJson(page, "/admin/settings");

    // Every credential field must be a password input. The API masks stored keys
    // to their last four characters; the screen must not undo that by echoing a
    // typed key back in the clear.
    const masked = await page.locator('input[type="password"]').count();
    expect(masked, "no masked credential fields on the settings screen").toBeGreaterThan(0);
    for (const field of await page.locator("input[type=text]").all()) {
      const value = await field.inputValue();
      expect(value, "a plain-text field on the settings screen looks like an API key").not.toMatch(
        /^(sk-|AIza)/,
      );
    }
  });

  const features = (await (
    await request.get("/api/admin/settings/features", { headers: auth })
  ).json()) as FeatureFlags;
  // A bounded numeric limit is the safest thing on this screen to write: it does
  // not touch a credential and it cannot start a vendor call.
  const restored = features.roleplay_max_turns;
  const changed = restored === 9 ? 8 : 9;

  const featuresNow = async (): Promise<number> => {
    const res = await request.get("/api/admin/settings/features", { headers: auth });
    return ((await res.json()) as FeatureFlags).roleplay_max_turns;
  };

  // By its label, never by position. This read `getByRole("spinbutton").first()`
  // until Faza 6.2 put a second number field above it, at which point the step
  // edited the phoneme drill's daily cap while still asserting against
  // `roleplay_max_turns` — the failure named a value, not a wrong field, so it
  // reads as a broken save rather than a test pointing at the wrong input.
  const maxTurns = () => page.getByRole("spinbutton", { name: /eng ko'p tur/i });

  await test.step("a feature limit is edited and saved", async () => {
    const turns = maxTurns();
    await expect(turns).toHaveValue(String(restored));
    await turns.fill(String(changed));
    await page.getByRole("button", { name: /Funksiyalarni saqlash/i }).click();

    await expect
      .poll(featuresNow, { message: "the settings screen's save never reached the database" })
      .toBe(changed);
  });

  await test.step("the saved value survives a reload, and is then restored", async () => {
    // A reload is the difference between "the form remembers" and "the server does".
    await goTo(page, "/admin/settings", /^\/admin\/settings$/);
    await expect(maxTurns()).toHaveValue(String(changed));

    await maxTurns().fill(String(restored));
    await page.getByRole("button", { name: /Funksiyalarni saqlash/i }).click();
    await expect
      .poll(featuresNow, { message: "the feature limit was left changed" })
      .toBe(restored);
  });

  expect(
    probeCalls,
    "something called the AI probe endpoint — each call bills every configured vendor",
  ).toBe(0);
});

/**
 * The admin subtree is the one place the panel's own roles diverge: `/teacher/*`
 * admits teachers AND admins, `/admin/*` admits admins only. Worth stating in a
 * test, because the two guards read almost identically in `App.tsx`.
 */
test("an admin may use the teacher panel but not the student screens", async ({ page }) => {
  await signInAs(page, adminId());

  await goTo(page, "/teacher", /^\/teacher$/);
  await goTo(page, "/teacher/queue", /^\/teacher\/queue$/);

  for (const studentOnly of ["/practice", "/results", "/progress"]) {
    await goTo(page, studentOnly, /^\/admin$/);
  }
});
