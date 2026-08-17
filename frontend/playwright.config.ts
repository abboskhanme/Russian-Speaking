/**
 * Playwright — the student golden path + axe (docs/08 Faza 4.11).
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
 *   docker run --rm --network govori-net \
 *     -v "$PWD/frontend":/w -v "$PWD/.env":/repo/.env:ro -w /w \
 *     -e GOVORI_ENV_FILE=/repo/.env -e E2E_STUDENT_ID=<uuid> \
 *     mcr.microsoft.com/playwright:v1.62.1-jammy npx playwright test
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

  // One journey, run in order, against ONE shared database. Parallel workers
  // would race each other's data and turn a real failure into "flaky".
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

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
