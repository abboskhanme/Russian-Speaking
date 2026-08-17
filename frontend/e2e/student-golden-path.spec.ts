/**
 * The student golden path: land → sign in → practice → see a result.
 *
 * ONE journey, in order, against the real stack — the sequence a first-time
 * visitor actually walks. It is written as a single `test` on purpose: these
 * steps are not independent, and splitting them into five tests would mean five
 * sign-ins and five chances to pass a step whose predecessor never happened.
 *
 * Every screen it passes through is also scanned by axe for CRITICAL violations,
 * which is the part no screenshot review has ever caught.
 *
 * Which module and which attempt to open are read from the API rather than
 * hard-coded, because the demo data is regenerated per database. The clicks
 * themselves are real clicks on real controls — that is what proves the routes
 * are wired, which is the thing `tsc` cannot see.
 */
import { mintAccessToken, studentId } from "./auth";
import {
  expect,
  expectNoCriticalA11y,
  expectNoRawJson,
  expectPath,
  expectVisibleText,
  goTo,
  signIn,
  test,
} from "./fixtures";

const UUID = "[0-9a-f-]{36}";

test("a student lands, signs in, opens a task and reads a graded result", async ({
  page,
  request,
}) => {
  const auth = { Authorization: `Bearer ${mintAccessToken(studentId())}` };

  /* ── 1. Land ──────────────────────────────────────────────────────────────
     A signed-out visitor must be BOUNCED, not shown an empty student Home. */
  await test.step("signed out, / redirects to the login screen", async () => {
    await goTo(page, "/", /^\/login$/);
    await expectVisibleText(page, /govori/);
    await expectNoCriticalA11y(page, "/login");
    await expectNoRawJson(page, "/login");
  });

  /* ── 2. Sign in ───────────────────────────────────────────────────────── */
  await test.step("with a session, / resolves to the student Home", async () => {
    await signIn(page);
    await goTo(page, "/", /^\/$/);
    // RoleHome sends teachers and admins elsewhere; a student stays on `/`. The
    // greeting is the cheapest proof the authed data actually arrived.
    await expectVisibleText(page, "talaba");
    await expectNoCriticalA11y(page, "/ (Home)");
    await expectNoRawJson(page, "/ (Home)");
  });

  /* ── 3. Practice ──────────────────────────────────────────────────────── */
  const modules = await (await request.get("/api/blocks/student", { headers: auth })).json();
  const target = modules.find((m: { next_task_id: string | null }) => m.next_task_id);
  expect(target, "the seeded student has no module with an actionable next task").toBeTruthy();

  await test.step("the nav reaches the Mashq hub", async () => {
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Mashq", exact: true })
      .click();
    // Without this the next step would run on Home and report "the module card is
    // missing" rather than "the nav button goes nowhere".
    await expectPath(page, /^\/practice$/);
    await expectNoCriticalA11y(page, "/practice");
  });

  await test.step("a module card opens its detail screen", async () => {
    await page.getByRole("button", { name: new RegExp(escapeRe(target.name)) }).first().click();
    await expectPath(page, new RegExp(`^/practice/module/${UUID}$`));
    await expectVisibleText(page, target.name);
    await expectNoCriticalA11y(page, "/practice/module/:id");
    await expectNoRawJson(page, "/practice/module/:id");
  });

  await test.step("Boshlash opens the recording screen for the next task", async () => {
    await page.getByRole("button", { name: "Boshlash", exact: true }).first().click();
    await expectPath(page, /^\/task$/);
    expect(new URL(page.url()).searchParams.get("task")).toMatch(new RegExp(`^${UUID}$`));
    await expectNoCriticalA11y(page, "/task");
    await expectNoRawJson(page, "/task");
  });

  /* ── 4. See a result ──────────────────────────────────────────────────────
     Recording needs a microphone, so the journey picks up at the other end of
     the same pipeline: an attempt this student has already had graded. This is
     the screen the raw-JSON grep exists for. */
  const results = await (
    await request.get("/api/profile/results?limit=5", { headers: auth })
  ).json();
  expect(results.length, "the seeded student has no graded attempts to open").toBeGreaterThan(0);

  await test.step("the results list opens one attempt's detail", async () => {
    await goTo(page, "/results", /^\/results$/);
    await expectNoCriticalA11y(page, "/results");

    await page.getByRole("button", { name: new RegExp(escapeRe(results[0].title)) }).first().click();
    await expectPath(page, new RegExp(`^/results/${UUID}$`));
  });

  await test.step("the graded result reads as prose, not as a payload", async () => {
    await expectVisibleText(page, String(results[0].band));
    await expectNoRawJson(page, "/results/:id");
    await expectNoCriticalA11y(page, "/results/:id");
  });
});

/**
 * The hazard every URL assertion above is guarding against, stated directly: a
 * route that does not exist for this user does not 404 and does not error — it
 * renders a perfectly good page at a different address.
 */
test("unknown and forbidden routes bounce silently to /", async ({ page }) => {
  await signIn(page);

  await goTo(page, "/definitely-not-a-route", /^\/$/);
  // RequireRole keeps a student out of the teacher subtree the same quiet way.
  await goTo(page, "/teacher/analytics", /^\/$/);
});

/** Demo titles are Russian prose and contain regex metacharacters. */
function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
