// Renders each manual .html (argv) to an A4 .pdf beside it, with a page-number
// footer. Run by build.sh inside the Playwright image; playwright itself comes
// from the frontend's node_modules, mounted at /w (as in screenshots/_tools).
import { createRequire } from "node:module";

const require = createRequire("/w/node_modules/");
const { chromium } = require("playwright");

const TITLES = {
  Admin: "Admin uchun qo‘llanma",
  Oqituvchi: "O‘qituvchi uchun qo‘llanma",
  Oquvchi: "O‘quvchi uchun qo‘llanma",
};

const browser = await chromium.launch();
const page = await browser.newPage();
for (const file of process.argv.slice(2)) {
  await page.goto(`file:///d/${file}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const role = file.replace(/^Govorim-qollanma-|\.html$/g, "");
  const out = file.replace(/\.html$/, ".pdf");
  await page.pdf({
    path: `/d/${out}`,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%;font-size:8px;color:#8a7d75;padding:0 13mm;display:flex;justify-content:space-between;font-family:sans-serif">
      <span>govorim.uz · ${TITLES[role] ?? ""}</span>
      <span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  console.log(`pdf   ${out}`);
}
await browser.close();
