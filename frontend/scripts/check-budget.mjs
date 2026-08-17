#!/usr/bin/env node
/**
 * Fails when the student's INITIAL JavaScript exceeds the docs/08 §4.1 budget.
 *
 * WHY THIS EXISTS. `vite build` succeeds no matter how large the bundle gets, and
 * the one number that decides whether the app opens on a 3G phone in Tashkent —
 * the bytes that must arrive before anything renders — is printed once, in a
 * scrolling build log nobody reads. Every route in `App.tsx` is deliberately
 * `lazy()` for exactly this reason, and a single static `import` accidentally
 * added to a shared module quietly pulls a whole route back into the entry chunk.
 * The build stays green; the app just gets slower every month.
 *
 * WHAT IS MEASURED. The entry chunk plus everything STATICALLY reachable from it,
 * transitively — the manifest's `imports`, never `dynamicImports`. Summing every
 * file in `dist/assets` instead would count all 30-odd lazy routes and make the
 * code split look like the regression. CSS is reported but not budgeted: the
 * stylesheet is a separate, parallel, non-blocking-parse request.
 *
 * Gzip at zlib's DEFAULT level, so the figure here is the same one `vite build`
 * prints beside each chunk rather than a second, disagreeing number.
 *
 * Run: `npm run check:budget` (after `npm run build`).
 */
import { gzipSync } from "node:zlib";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const MANIFEST = join(DIST, ".vite", "manifest.json");

/** docs/08 §4.1. KiB, matching how every bundler tool reports "KB". */
const BUDGET_BYTES = 180 * 1024;

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch {
  console.error(
    `✗ no build manifest at ${MANIFEST}\n\n` +
      "Run `npm run build` first. If the build DID run, check that\n" +
      "`build.manifest` is still enabled in vite.config.ts — without it there is\n" +
      "no way to tell the initial entry graph from the lazy route chunks, and this\n" +
      "budget would have to be dropped rather than quietly measure the wrong thing.",
  );
  process.exit(1);
}

const entries = Object.keys(manifest).filter((key) => manifest[key].isEntry);
if (entries.length === 0) {
  console.error("✗ the build manifest declares no entry chunk — nothing to measure.");
  process.exit(1);
}

/** Manifest keys statically reachable from `roots` (dynamic imports excluded). */
function staticGraph(roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const key = queue.pop();
    if (seen.has(key)) continue;
    const chunk = manifest[key];
    if (!chunk) continue; // an import Vite resolved outside the manifest
    seen.add(key);
    // `dynamicImports` is deliberately NOT followed — that is the code split.
    for (const next of chunk.imports ?? []) queue.push(next);
  }
  return seen;
}

const graph = staticGraph(entries);

const js = new Map();
const css = new Map();
for (const key of graph) {
  const chunk = manifest[key];
  js.set(chunk.file, gzipSync(readFileSync(join(DIST, chunk.file))).length);
  for (const sheet of chunk.css ?? []) {
    css.set(sheet, gzipSync(readFileSync(join(DIST, sheet))).length);
  }
}

const total = [...js.values()].reduce((a, b) => a + b, 0);
const cssTotal = [...css.values()].reduce((a, b) => a + b, 0);
const rawTotal = [...js.keys()].reduce((a, file) => a + statSync(join(DIST, file)).size, 0);

// The current number is printed on EVERY run, pass or fail — a budget that only
// ever speaks up when it is breached teaches nothing about the trend.
console.log(
  `initial JS: ${kb(total)} gzip (${kb(rawTotal)} raw) across ${js.size} chunk${js.size === 1 ? "" : "s"}` +
    `  ·  budget ${kb(BUDGET_BYTES)}  ·  ${kb(Math.abs(BUDGET_BYTES - total))} ${total <= BUDGET_BYTES ? "headroom" : "OVER"}`,
);
console.log(`initial CSS: ${kb(cssTotal)} gzip (not budgeted — separate parallel request)`);

const lazy = Object.keys(manifest).length - graph.size;
console.log(`lazy chunks kept out of the entry graph: ${lazy}`);

if (total > BUDGET_BYTES) {
  console.error(
    `\n✗ initial JS is ${kb(total - BUDGET_BYTES)} over the ${kb(BUDGET_BYTES)} budget.\n\n` +
      "Largest chunks in the entry graph:\n" +
      [...js.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([file, size]) => `  ${kb(size).padStart(9)}  ${file}`)
        .join("\n") +
      "\n\nUsually this is a route or a heavy library that lost its `lazy()` / dynamic\n" +
      "import and is now statically reachable from main.tsx. Raising the budget is\n" +
      "not the fix — the number is what a first-time visitor waits for.",
  );
  process.exit(1);
}

process.exit(0);
