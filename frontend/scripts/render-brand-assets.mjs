// Renders the raster brand files in public/ from public/favicon.svg (the single source):
//   favicon-32.png · favicon.ico · apple-touch-icon.png (180) · icon-512.png · og-image.png (1200×630)
//
// One-off, not part of the build — re-run only when the mark or the OG copy changes, and
// commit the outputs. Needs a Chromium, so run it in the Playwright image (same version
// as e2e, docs/09-DOCKER.md):
//
//   docker run --rm -v "$PWD/frontend":/w -w /w mcr.microsoft.com/playwright:v1.62.1-jammy \
//     node scripts/render-brand-assets.mjs
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const pub = new URL("../public/", import.meta.url);
const svg = readFileSync(new URL("favicon.svg", pub), "utf8");
const svgUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const onest = readFileSync(new URL("../src/shared/styles/fonts/Onest-Variable.woff2", import.meta.url));

// --primary / --bg / --ink from src/shared/styles/tokens.css, as sRGB.
const PRIMARY = "#ed622a";
const BG = "#fbf6f1";
const INK = "#3a2c22";

const browser = await chromium.launch();
const page = await browser.newPage();

async function shot(html, width, height, { transparent = false } = {}) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: Onest; font-weight: 100 900;
      src: url(data:font/woff2;base64,${onest.toString("base64")}) format("woff2"); }
    html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
    body { font-family: Onest, sans-serif; }
  </style></head><body>${html}</body></html>`);
  await page.evaluate(() =>
    Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode())]),
  );
  return page.screenshot({ omitBackground: transparent, type: "png" });
}

const icon = (size, bg) =>
  `<div style="width:${size}px;height:${size}px;background:${bg}">
     <img src="${svgUrl}" width="${size}" height="${size}" style="display:block"></div>`;

// Browser tab: rounded tile on transparent. Home-screen icons: iOS and Android mask the
// corners themselves, so the tile is full-bleed there (a transparent corner turns black).
const fav16 = await shot(icon(16, "transparent"), 16, 16, { transparent: true });
const fav32 = await shot(icon(32, "transparent"), 32, 32, { transparent: true });
writeFileSync(new URL("favicon-32.png", pub), fav32);
writeFileSync(new URL("apple-touch-icon.png", pub), await shot(icon(180, PRIMARY), 180, 180));
writeFileSync(new URL("icon-512.png", pub), await shot(icon(512, PRIMARY), 512, 512));

// favicon.ico = an ICO directory wrapping the PNGs verbatim (valid since Vista; every
// current browser reads it). Only crawlers and old clients ask for /favicon.ico.
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(([size, png], i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size, e);
    head.writeUInt8(size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...pngs.map(([, png]) => png)]);
}
writeFileSync(new URL("favicon.ico", pub), ico([[16, fav16], [32, fav32]]));

// Link preview (Telegram, WhatsApp, Facebook, X): 1200×630, text kept inside the
// centre-safe area because some clients crop to 1.91:1 or square.
const og = `
<div style="width:1200px;height:630px;background:${BG};color:${INK};display:flex;align-items:center;
            gap:64px;padding:0 110px;box-sizing:border-box;position:relative">
  <img src="${svgUrl}" width="260" height="260" style="flex:none;border-radius:62px;
       box-shadow:0 24px 60px -18px ${PRIMARY}99">
  <div>
    <div style="font-size:112px;font-weight:900;letter-spacing:-0.035em;line-height:1">govorim</div>
    <div style="font-size:52px;font-weight:700;margin-top:28px;color:${PRIMARY}">Rus tilida gapiring</div>
    <div style="font-size:30px;font-weight:500;margin-top:18px;opacity:.72;line-height:1.3">
      Ovozli mashqlar, tezkor baho<br>va oʻqituvchi nazorati</div>
  </div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:14px;background:${PRIMARY}"></div>
</div>`;
writeFileSync(new URL("og-image.png", pub), await shot(og, 1200, 630));

await browser.close();
console.log("brand assets written to public/");
