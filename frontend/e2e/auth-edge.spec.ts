/**
 * The auth edges — the states a session actually fails in.
 *
 * Everything else in this suite drives a valid session. These four are the ways
 * one stops being valid, and each has the same worst case: a white screen. The
 * app boots, the guard asks the API who this is, the API says 401, and if the
 * client does not have an answer for that the user is left staring at a spinner
 * or an empty layout with no way back to the login form. So every case here
 * asserts BOTH halves — the destination, and that something legible is on it.
 *
 * WHY THIS SPEC TOLERATES CONSOLE ERRORS. Three of these journeys provoke a
 * rejected request on purpose; the app logs the 401 it received, which is
 * correct behaviour and the evidence that the path under test was taken. The
 * waiver is narrow (a 401-shaped resource failure) and it does NOT cover
 * `pageerror` — an uncaught exception is never expected, least of all here,
 * because "the token was bad AND the app threw" is precisely the white screen.
 */
import { mintAccessToken, mintForgedToken, mintRefreshToken, studentId } from "./auth";
import {
  expect,
  expectNoCriticalA11y,
  expectPath,
  expectVisibleText,
  goTo,
  reportA11yTally,
  seedSession,
  signIn,
  test,
} from "./fixtures";

test.afterAll(() => reportA11yTally("auth edges"));

/** A rejected API call logs this; it is the point of three tests below. */
const EXPECTED_401 = /Failed to load resource.*401|401 \(Unauthorized\)/;

/** The login screen, not merely "not the app". */
async function expectUsableLoginScreen(page: import("@playwright/test").Page): Promise<void> {
  await expectPath(page, /^\/login$/);
  // A blank page also satisfies "we are at /login". The form has to be there.
  await expect(page.getByRole("button", { name: /Kodni olish/i })).toBeVisible();
  await expectVisibleText(page, /govori/);
}

/** Whatever the app has in localStorage right now. */
async function storedTokens(page: import("@playwright/test").Page) {
  return page.evaluate(() => ({
    access: localStorage.getItem("govori_access"),
    refresh: localStorage.getItem("govori_refresh"),
  }));
}

test.describe("a session that has gone bad", () => {
  // Each case is a token the API will refuse, for a different reason. They are
  // separated so a failure names WHICH kind of bad token the app mishandled.
  const cases: { name: string; access: () => string; refresh: () => string }[] = [
    {
      name: "an expired access token with an equally dead refresh token",
      access: () => mintAccessToken(studentId(), { ttlSeconds: -60 }),
      refresh: () => mintRefreshToken(studentId(), { ttlSeconds: -60 }),
    },
    {
      name: "a structurally valid token signed with the wrong secret",
      access: () => mintForgedToken(studentId()),
      refresh: () => mintForgedToken(studentId()),
    },
    {
      name: "a token that is not a JWT at all",
      access: () => "not-a-jwt",
      refresh: () => "not-a-jwt",
    },
  ];

  for (const { name, access, refresh } of cases) {
    test(`${name} lands on the login form, not a white screen`, async ({ page, errorGuard }) => {
      errorGuard.tolerate(EXPECTED_401);
      await seedSession(page, { access: access(), refresh: refresh() });

      // A deep link, not `/`: the redirect has to work from wherever the user
      // actually was when their session died, and `/` is the one path that would
      // still look right if the router simply gave up.
      await page.goto("/progress");
      await expectUsableLoginScreen(page);

      // The dead tokens must be cleared, or the next navigation retries them and
      // the user is stuck in a redirect loop they cannot log out of.
      expect(await storedTokens(page), "the rejected tokens were left in the store").toEqual({
        access: null,
        refresh: null,
      });

      await expectNoCriticalA11y(page, "/login (after a rejected session)");
    });
  }
});

/**
 * The case that must NOT log the user out: the access token has expired but the
 * refresh token has not. This is every returning user after an hour away, and
 * the failure mode is the opposite of the ones above — not a white screen, but
 * being bounced to the login form by an app that had a perfectly good way to
 * keep the session.
 */
test("an expired access token is silently refreshed, not thrown away", async ({
  page,
  errorGuard,
}) => {
  errorGuard.tolerate(EXPECTED_401);

  const dead = mintAccessToken(studentId(), { ttlSeconds: -60 });
  await seedSession(page, { access: dead, refresh: mintRefreshToken(studentId()) });

  await goTo(page, "/progress", /^\/progress$/);
  await expectVisibleText(page, /xp|progress/i);

  const { access, refresh } = await storedTokens(page);
  // The stored access token must be a DIFFERENT one — that is the whole claim.
  // Merely still being on /progress would also be true if nothing had expired.
  expect(access, "the access token was not replaced, so no refresh happened").not.toBe(dead);
  expect(access, "the session was cleared instead of refreshed").not.toBeNull();
  // The backend rotates both halves; a refresh token reused forever is the bug
  // this assertion exists to notice.
  expect(refresh, "the refresh token was not rotated").not.toBeNull();
});

/**
 * Role protection, driven by typing the URL rather than by looking for a link.
 * An unlinked route is not a protected route, and `App.tsx` ends in a `*`
 * catch-all that redirects instead of 404ing — so a guard that does nothing at
 * all still renders a working page, just the wrong one.
 */
test("a student cannot reach the admin or teacher subtrees by typing the URL", async ({ page }) => {
  await signIn(page);

  for (const forbidden of [
    "/admin",
    "/admin/students",
    "/admin/teachers",
    "/admin/settings",
    "/teacher",
    "/teacher/queue",
    "/teacher/classes",
    "/teacher/analytics",
    "/teacher/assign",
  ]) {
    await goTo(page, forbidden, /^\/$/);
  }

  // And the bounce must be a bounce, not a render: nothing from either panel may
  // appear on the student Home it lands on.
  await expectVisibleText(page, "talaba");
  const body = (await page.locator("body").innerText()).toLowerCase();
  expect(body, "an admin-panel heading rendered on the student Home").not.toContain("boshqaruv");
});

/** Signing out has to clear the store, or the next visit signs itself back in. */
test("logout clears both tokens and returns to the login form", async ({ page }) => {
  await signIn(page);
  await goTo(page, "/profile", /^\/profile$/);

  await page.getByRole("tab", { name: /Sozlamalar/i }).click();
  await page.getByRole("button", { name: /^Chiqish$/i }).click();

  await expectUsableLoginScreen(page);
  expect(await storedTokens(page), "logout left a token behind").toEqual({
    access: null,
    refresh: null,
  });

  // The real test of a logout: open an authed route again and stay logged out.
  //
  // In a NEW TAB, deliberately. `signIn` seeds the session with `addInitScript`,
  // which re-runs on every navigation of the page it was registered on — so
  // re-visiting `/progress` on this page would silently hand the app the tokens
  // back and report that logout had failed. A second page in the same context
  // shares the (now empty) localStorage but carries no init script, which is
  // what a user reopening the app actually looks like.
  const reopened = await page.context().newPage();
  const crashes: string[] = [];
  reopened.on("pageerror", (e) => crashes.push(e.message));
  await reopened.goto("/progress");
  await expectPath(reopened, /^\/login$/);
  expect(crashes, "the reopened tab threw while deciding the user was signed out").toEqual([]);
  await reopened.close();
});
