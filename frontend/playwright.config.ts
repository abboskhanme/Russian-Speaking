/**
 * Playwright — the student, teacher and admin golden paths, the auth edges, and
 * axe on every screen they pass through (docs/08 Faza 4.11).
 *
 * NO `webServer` BLOCK ON PURPOSE. The suite runs against the real compose stack
 * (nginx + .NET API + Postgres + Redis + MinIO), not a `vite preview` of the SPA,
 * because half of what is being checked — the `/api` proxy, real 401 handling,
 * real graded attempts — does not exist in front of a static server. Bring the
 * stack up first (`docker compose up -d`).
 *
 * The default base URL is `http://govori-web`, the service name on `govori-net`,
 * i.e. port 80 INSIDE the network — the same nginx a phone on the LAN reaches.
 * `localhost:8081` must not be used from inside a container: it resolves to the
 * test container itself.
 *
 *   docker run --rm --network govori-net --ipc=host \
 *     -v "$PWD/frontend":/w -v "$PWD/.env":/repo/.env:ro -w /w \
 *     -e GOVORI_ENV_FILE=/repo/.env \
 *     -e E2E_STUDENT_ID=<uuid> -e E2E_ADMIN_ID=<uuid> \
 *     mcr.microsoft.com/playwright:v1.62.1-jammy npx playwright test
 *
 * `--ipc=host` IS NOT OPTIONAL, and its absence does not look like a missing
 * flag. Docker gives a container 64MB of `/dev/shm`; Chromium keeps its renderer
 * shared memory there, and once the suite grew past a couple of specs it began
 * exhausting it mid-run. The symptom is `Target crashed` thrown from whatever
 * call happened to be in flight — `addInitScript`, `evaluate`, `innerText` — so
 * it presents as a different broken test every time, which is the exact shape of
 * "the suite is flaky, just retry it". A six-test run took 2.4 minutes and
 * failed three assorted tests without it, and 6 seconds with it.
 * (`--shm-size=1g` works too; `--ipc=host` is what Playwright's own docs use.)
 *
 * Two user ids are required, and only two. `E2E_TEACHER_ID` is deliberately NOT
 * one of them — which teacher can drive the Navbat journey depends on who has a
 * non-empty grading queue, so `e2e/people.ts` resolves that through the admin
 * API instead of asking anyone to keep a third variable true.
 *
 * The image tag must match the `@playwright/test` version exactly (Playwright
 * refuses to drive browsers it was not built against), which is why that
 * dependency is pinned rather than caret-ranged.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.artifacts",
  globalSetup: "./e2e/global-setup.ts",

  // The journeys run in order against ONE shared database, and several of them
  // write to it. Parallel workers would race each other's data and turn a real
  // failure into "flaky".
  fullyParallel: false,
  workers: 1,
  // No retries: a retry that goes green is not a pass, it is an unexamined bug.
  retries: 0,
  forbidOnly: !!process.env.CI,

  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://govori-web",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },

    /**
     * The student journey again at phone size — a PROJECT, not a copied spec, so
     * the two can never drift into testing different things.
     *
     * 390×844 is not a cosmetic re-run. The nav is rendered twice and CSS picks
     * one per breakpoint: the sidebar drives the desktop pass and the bottom bar
     * drives this one, so the same `clickNav` call exercises a different element
     * here. `isMobile` + `hasTouch` come along because the app's controls branch
     * on pointer type, and a mouse click on a touch-only handler is the classic
     * "works on my machine" pass.
     *
     * Only the student path runs here. The teacher and admin panels are desk
     * tools whose phone layout is not a shipping concern, and doubling their
     * runtime would buy a slower suite rather than a better one.
     */
    {
      name: "mobile-chromium",
      testMatch: /student-golden-path\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
