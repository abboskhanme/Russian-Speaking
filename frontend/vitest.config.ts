/**
 * Vitest — unit / component tests (docs/08 Faza 4.11).
 *
 * A SEPARATE config rather than a `test` block inside vite.config.ts, because the
 * dev/build config loads `@tailwindcss/vite`, which scans every source file for
 * class names to produce a stylesheet no assertion here ever reads. Vitest picks
 * this file over vite.config.ts automatically.
 *
 * jsdom is the environment for the WHOLE suite, not just the component tests: the
 * pure helpers here are not actually environment-free either — `theme.ts`,
 * `tokens.ts` and `placed.ts` all read `localStorage`, and under the `node`
 * environment they silently take their `catch` branch and every assertion passes
 * for the wrong reason.
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    // Deliberately no `globals: true` — every test imports `describe`/`it`/`expect`
    // from "vitest" explicitly, so `tsc --noEmit` typechecks the suite against the
    // repo's existing tsconfig without a `types: ["vitest/globals"]` entry.
    globals: false,
    environment: "jsdom",
    restoreMocks: true,
  },
});
