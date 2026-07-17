# Vendored fonts — Ovoz DS

`fonts.css` (one directory up) declares `@font-face` for **Onest** and
**JetBrains Mono** pointing at self-hosted `.woff2` files in *this* folder.
The binaries are **not** committed — a human (or the build) must drop them here.
Do **not** re-point these at a CDN.

## Files to vendor (drop them in this folder, exact names)

| File | Family | Weights covered | Format | Axis |
|------|--------|-----------------|--------|------|
| `Onest-Variable.woff2` | Onest | 100–900 (DS uses 400/500/600/700/800) | woff2 | `wght` |
| `JetBrainsMono-Variable.woff2` | JetBrains Mono | 100–800 (DS uses 400/500) | woff2 | `wght` |

One variable file per family = one request each, and every weight the DS needs
resolves from it. If you prefer static weights instead, ship
`Onest-{400,500,600,700,800}.woff2` + `JetBrainsMono-{400,500}.woff2` and update
`fonts.css` to one `@font-face` per file — but the variable file is preferred.

## Where to get them (both OFL-licensed — free to self-host & redistribute)

**Onest** — Google Fonts, designed by Rosetta / Martin Vácha.
- Source repo: <https://github.com/google/fonts> → `ofl/onest/Onest[wght].ttf`
- Easiest via npm (Docker): `@fontsource-variable/onest` ships
  `onest-cyrillic-wght-normal.woff2` — copy it here as `Onest-Variable.woff2`.
- License: SIL OFL 1.1.

**JetBrains Mono** — JetBrains.
- Releases: <https://github.com/JetBrains/JetBrainsMono/releases>
  (the webfont bundle contains `JetBrainsMono[wght].woff2`).
- Or npm: `@fontsource-variable/jetbrains-mono` →
  `jetbrains-mono-cyrillic-wght-normal.woff2` → copy as `JetBrainsMono-Variable.woff2`.
- License: SIL OFL 1.1.

> Docker-only workflow (no local Node): fetch inside a throwaway container, e.g.
> `docker run --rm -v "$PWD":/w -w /w node:20-alpine sh -c \
>   "npm i @fontsource-variable/onest @fontsource-variable/jetbrains-mono && \
>    cp node_modules/@fontsource-variable/onest/files/*cyrillic-wght-normal.woff2 Onest-Variable.woff2 && \
>    cp node_modules/@fontsource-variable/jetbrains-mono/files/*cyrillic-wght-normal.woff2 JetBrainsMono-Variable.woff2"`
> (verify the exact filenames in `files/` — fontsource splits by unicode subset;
> take the one that includes the `cyrillic` + `latin` coverage the app needs.)

## Why the CDN is forbidden in prod (docs/08 item 4.4)

The mockups use
`https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500`.
For govorim.uz that is wrong because:

1. **LCP regression** — the exit criterion for 4.4 is *"LCP regress yo'q"*. A CDN
   font adds extra DNS + TLS + a two-hop request (CSS then the woff2) on the
   critical path. Self-hosting from the app origin removes those round-trips and
   lets us `<link rel="preload">` the woff2.
2. **Availability / region** — Google's font hosts are unreliable or blocked in
   parts of the target region; a self-hosted asset can't fail independently of
   the app.
3. **Privacy / caching** — no third-party request per visitor; we control
   `Cache-Control` and immutable hashing on our own asset.

## Coverage the files must include (verify before shipping)

- Onest: Latin, **Cyrillic**, and the Uzbek modifier letters `oʻ` / `gʻ`
  (U+02BB MODIFIER LETTER TURNED COMMA) — the product renders Uzbek + Russian.
- JetBrains Mono: Latin + **Cyrillic** (transcripts show Russian, e.g. `магази́н`,
  and IPA phonemes like `[məɡɐˈzin]`).
