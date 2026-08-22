/**
 * e2e/fixtures — the three guards that have each caught a real bug in this app,
 * plus the token injection.
 *
 * A screenshot-driven check passes far too easily. Each of these exists because
 * something shipped past a human looking at the screen:
 *
 *   1. URL ASSERTION. `App.tsx` ends in `<Route path="*" element={<Navigate to="/" />} />`.
 *      A destination with no route does not 404 — it bounces to the role home, so
 *      the test drives to `/teacher/analytics`, arrives at `/teacher`, finds a page
 *      that renders fine, and reports a pass. Every navigation here must state the
 *      pathname it expects to be standing on afterwards.
 *   2. ERROR COLLECTION. An uncaught render error inside a Suspense boundary, or a
 *      failed `/api` call, leaves the layout intact and the data missing. Nothing
 *      is red on screen; it is only in the console.
 *   3. RAW-JSON GREP. `evaluations.feedback` stores a serialised `GraderResult`,
 *      and printing the column put `{"summary":…}` in front of students. It looks
 *      like text in a screenshot.
 *
 * Cross-origin resource failures are the one thing deliberately NOT failed on:
 * avatars and attempt audio are signed against `S3_PUBLIC_URL`
 * (`http://localhost:9000`), which is reachable from the developer's browser and
 * not from inside the test container. Same-origin failures still fail the run.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test as base } from "@playwright/test";
import type { ConsoleMessage, Page } from "@playwright/test";
import { mintAccessToken, mintRefreshToken, studentId } from "./auth";

/**
 * The console-error collector, with a narrow escape hatch.
 *
 * `tolerate` exists for ONE situation: a journey whose subject is a failure, so
 * the failure's own console noise is the evidence rather than a regression. The
 * auth-edge spec drives a rejected token on purpose and the app dutifully logs
 * the 401 it got. Every pattern passed here must be justified in the spec —
 * "the run is noisy" is not a reason, it is the finding.
 */
export interface ErrorGuard {
  tolerate(...patterns: RegExp[]): void;
  /** Everything collected so far, for a spec that wants to assert positively. */
  seen(): string[];
}

export const test = base.extend<{ errorGuard: ErrorGuard }>({
  // `auto` so a test cannot opt out by forgetting to name the fixture — the whole
  // value of an error collector is that it is never the thing you remembered.
  errorGuard: [
    async ({ page, baseURL }, use) => {
      const origin = new URL(baseURL ?? "http://govori-web").origin;
      const errors: string[] = [];
      const tolerated: RegExp[] = [];

      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
      page.on("console", (message: ConsoleMessage) => {
        if (message.type() !== "error") return;
        if (isForeignResourceFailure(message, origin)) return;
        errors.push(`console.error: ${message.text()}`);
      });

      await use({
        tolerate: (...patterns) => tolerated.push(...patterns),
        seen: () => [...errors],
      });

      // A `pageerror` is an uncaught exception and is never tolerable, however
      // the journey was set up — only console noise can be waived.
      const unexpected = errors.filter(
        (e) => e.startsWith("pageerror:") || !tolerated.some((p) => p.test(e)),
      );
      expect(unexpected, "the page logged errors during this journey").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

function isForeignResourceFailure(message: ConsoleMessage, origin: string): boolean {
  if (!/Failed to load resource|net::ERR_/.test(message.text())) return false;
  const url = message.location().url;
  return !!url && !url.startsWith(origin);
}

/**
 * Seed the token store before the SPA boots.
 *
 * `addInitScript` rather than a post-load `evaluate`: the auth context reads the
 * token store during its first render, so a token written after load is only
 * picked up on the NEXT navigation — which reads as "the app ignored my login".
 * The theme and language are pinned in the same script so a run is not at the
 * mercy of the container's `prefers-color-scheme`.
 */
export async function seedSession(
  page: Page,
  tokens: { access: string; refresh: string },
): Promise<void> {
  await page.addInitScript(
    ([access, refresh]) => {
      localStorage.setItem("govori_access", access);
      localStorage.setItem("govori_refresh", refresh);
      localStorage.setItem("govori-theme", "light");
      localStorage.setItem("govori_lang", "uz");
    },
    [tokens.access, tokens.refresh],
  );
}

/** Sign in as any user id — the teacher and admin journeys' entry point. */
export async function signInAs(page: Page, userId: string): Promise<void> {
  await seedSession(page, {
    access: mintAccessToken(userId),
    refresh: mintRefreshToken(userId),
  });
}

/** Sign in as the seeded student (the original golden path's entry point). */
export async function signIn(page: Page): Promise<void> {
  await signInAs(page, studentId());
}

/**
 * Click a nav destination by its exact label — the ONLY sanctioned way to drive
 * the nav.
 *
 * Two hazards live here, and both have produced a green run that proved nothing:
 *
 *   1. The nav is rendered TWICE (a sidebar and a bottom bar); CSS shows one per
 *      breakpoint. Playwright's role engine currently resolves the hidden copy
 *      out, so this is exactly one element — but that is a property of the
 *      layout, not a guarantee. The count assertion turns a future regression
 *      into a legible failure instead of a strict-mode stack trace.
 *   2. A LOOSE name matches the bottom bar's button first, the page silently
 *      changes underneath the test, and every later step reports "element not
 *      found" while the real fault was three steps earlier. Hence `exact`, and
 *      hence a required `expectedPath` — arriving somewhere is not the same as
 *      arriving where the nav claims to go.
 */
export async function clickNav(page: Page, label: string, expectedPath: RegExp): Promise<void> {
  const item = page.getByRole("navigation").getByRole("button", { name: label, exact: true });
  await expect(item, `exactly one visible nav button named "${label}"`).toHaveCount(1);
  await item.click();
  await expectPath(page, expectedPath);
  await waitForApp(page);
}

/** Assert the pathname we are actually standing on, polling out the SPA redirect. */
export async function expectPath(page: Page, expected: RegExp): Promise<void> {
  await expect
    .poll(() => new URL(page.url()).pathname, { message: `expected to land on ${expected}` })
    .toMatch(expected);
}

/**
 * Wait out the Suspense fallback.
 *
 * Every route is `lazy()` and the auth guard has its own boot fallback, so for the
 * first few hundred ms the entire document is one spinner. Reading the DOM then
 * makes the negative checks below meaningless — there is certainly no raw JSON
 * and no critical a11y violation on a spinner. So the guards call this first
 * rather than trusting each caller to remember.
 */
export async function waitForApp(page: Page): Promise<void> {
  await expect
    .poll(async () => (await page.locator("body").innerText()).trim(), {
      message: "the app never got past its loading fallback",
    })
    .not.toMatch(/^yuklanmoqda…?$/i);
}

/** Navigate and assert the destination in one step, so neither can be forgotten. */
export async function goTo(page: Page, path: string, expected: RegExp): Promise<void> {
  await page.goto(path);
  await expectPath(page, expected);
  await waitForApp(page);
}

/** Patterns that mean a serialised object reached the reader. */
const RAW_JSON = [
  /\{\s*"[a-z_]+"\s*:/i,
  /\[\s*\{\s*"/,
  /"(summary|strengths|improvements|vocabulary_suggestions|orthoepy_errors|corrections)"\s*:/,
];

export async function expectNoRawJson(page: Page, where: string): Promise<void> {
  await waitForApp(page);
  const text = await page.locator("body").innerText();
  for (const pattern of RAW_JSON) {
    expect(text, `raw JSON leaked into the UI on ${where}`).not.toMatch(pattern);
  }
}

/**
 * Running total of the non-blocking findings, keyed `impact/rule`.
 *
 * The serious tier — `color-contrast` above all — is someone else's open work,
 * so failing on it here would only teach the next person to delete the check.
 * Counting it instead means the number is on the record every run, and a jump
 * is visible rather than merely allowed.
 */
const a11yTally = new Map<string, { screens: Set<string>; nodes: number }>();

/** Print what axe found across the run. Call from a spec's `test.afterAll`. */
export function reportA11yTally(label: string): void {
  if (a11yTally.size === 0) return;
  const rows = [...a11yTally.entries()].sort((a, b) => b[1].nodes - a[1].nodes);
  console.log(`\n  a11y summary — ${label} (non-blocking; critical is asserted separately)`);
  for (const [rule, { screens, nodes }] of rows) {
    console.log(`    ${rule}: ${nodes} nodes across ${screens.size} screen(s)`);
  }
}

/**
 * Zero CRITICAL axe violations. Serious/moderate findings are tallied and
 * printed rather than failed, so the gate is a floor the app can actually hold
 * rather than a step everyone learns to skip.
 */
export async function expectNoCriticalA11y(page: Page, where: string): Promise<void> {
  await waitForApp(page);
  const { violations } = await new AxeBuilder({ page }).analyze();

  const notable = violations.filter((v) => v.impact === "serious" || v.impact === "moderate");
  for (const v of notable) {
    const key = `${v.impact}/${v.id}`;
    const entry = a11yTally.get(key) ?? { screens: new Set<string>(), nodes: 0 };
    entry.screens.add(where);
    entry.nodes += v.nodes.length;
    a11yTally.set(key, entry);
  }
  if (notable.length > 0) {
    console.log(
      `  a11y (non-blocking) on ${where}: ` +
        notable.map((v) => `${v.impact}/${v.id} ×${v.nodes.length}`).join(", "),
    );
  }

  const critical = violations
    .filter((v) => v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  expect(critical, `critical accessibility violations on ${where}`).toEqual([]);
}

/**
 * Case-INSENSITIVE body-text check, polled.
 *
 * Case-insensitive because `innerText` reports RENDERED casing: half the labels
 * here are uppercased in CSS, so a literal "Topshiriqlar" never matches. Polled
 * because the data arrives after the route chunk does.
 */
export async function expectVisibleText(page: Page, needle: string | RegExp): Promise<void> {
  const body = async () => (await page.locator("body").innerText()).toLowerCase();
  if (typeof needle === "string") {
    await expect.poll(body, { message: `expected the page to show "${needle}"` }).toContain(
      needle.toLowerCase(),
    );
  } else {
    await expect.poll(body, { message: `expected the page to match ${needle}` }).toMatch(needle);
  }
}
