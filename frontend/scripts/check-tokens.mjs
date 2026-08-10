#!/usr/bin/env node
/**
 * Fails when a stylesheet reads a CSS custom property nothing defines.
 *
 * WHY THIS EXISTS. `var(--nope)` is not an error anywhere in the toolchain: the
 * declaration is simply invalid at computed-value time and the property silently
 * falls back to its inherited or initial value. Nothing warns — not the browser
 * console, not the build, not eslint — so the rule just quietly does nothing.
 *
 * This has already bitten twice. All eight teacher stylesheets used
 * `var(--focus)` and `var(--motion-fast)` (the real names being `--focus-ring`
 * and `--m-fast`), which meant the entire teacher panel had NO visible focus ring
 * for keyboard users and no hover transitions, for five phases, while looking
 * completely fine in review. Two more screens then used `var(--motion-slow)`.
 *
 * A `var(--x, fallback)` with an explicit fallback is fine and is not reported —
 * that is a deliberate default, not a typo.
 *
 * Run: `npm run check:tokens`
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** Definitions can sit SEVERAL PER LINE — the typography scale does exactly that
 * (`--t-body-size: 15px;  --t-body-line: 22px;  …`). A line-anchored pattern
 * misses all but the first and reports ~25 false positives. */
const DEFINITION = /(--[a-z0-9-]+)\s*:/gi;
/** Only usages with NO fallback: `var(--x)` and `var(--x , …)` differ in intent. */
const USAGE_NO_FALLBACK = /var\(\s*(--[a-z0-9-]+)\s*\)/g;

function cssFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(path));
    else if (entry.name.endsWith(".css")) out.push(path);
  }
  return out;
}

const files = cssFiles(SRC);

// Global (non-module) stylesheets hold the shared scales; a module may also define
// its own locals, which count only inside that file.
const globalTokens = new Set();
for (const file of files) {
  if (file.includes(".module.css")) continue;
  for (const [, name] of readFileSync(file, "utf8").matchAll(DEFINITION)) {
    globalTokens.add(name);
  }
}

const dead = new Map();
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const local = new Set([...src.matchAll(DEFINITION)].map(([, name]) => name));
  for (const [, name] of src.matchAll(USAGE_NO_FALLBACK)) {
    if (globalTokens.has(name) || local.has(name)) continue;
    if (!dead.has(name)) dead.set(name, new Set());
    dead.get(name).add(relative(SRC, file));
  }
}

if (dead.size === 0) {
  console.log(`✓ ${globalTokens.size} tokens defined; no undefined var() in ${files.length} stylesheets`);
  process.exit(0);
}

console.error(`✗ ${dead.size} undefined CSS custom propert${dead.size === 1 ? "y" : "ies"}:\n`);
for (const [name, where] of dead) {
  console.error(`  var(${name})  —  ${[...where].join(", ")}`);
}
console.error(
  "\nEach of these silently does nothing at runtime. Fix the name, or give it an\n" +
    "explicit fallback (`var(--x, 4px)`) if the default is intentional.",
);
process.exit(1);
