// Renders public/og.png (1200x630), the Open Graph and Twitter card image.
// Run from apps/docs: node scripts/generate-og.mjs
// Needs network for Google Fonts and a Playwright Chromium (`pnpm exec playwright install chromium`).
// The mark comes from public/logo.svg, so run scripts/generate-logo.mjs first if the mark changed.
import { readFileSync } from "node:fs";

import { chromium } from "playwright-core";

const mark = readFileSync(new URL("../public/logo.svg", import.meta.url), "utf8")
  // Pin the light colours: the card must not follow the viewer's OS theme.
  .replace(/@media \(prefers-color-scheme:dark\)\{[^}]*\}[^}]*\}[^}]*\}\}/, "");

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,700,0,1&family=Hanken+Grotesk:wght@400;500&display=block">
<style>
  html, body { margin: 0; }
  body {
    width: 1200px; height: 630px; box-sizing: border-box;
    display: grid; grid-template-columns: 1fr 380px; align-items: center; gap: 48px;
    padding: 0 88px; background: #f5efe2; color: #2a1b3d;
    font-family: "Hanken Grotesk", sans-serif;
  }
  .name { font: 700 40px/1 Fraunces, serif; font-variation-settings: "SOFT" 0, "WONK" 1;
    letter-spacing: -0.02em; }
  h1 { margin: 36px 0 0; font: 700 70px/1.06 Fraunces, serif; font-variation-settings: "SOFT" 0, "WONK" 1;
    letter-spacing: -0.025em; text-wrap: balance; }
  p { margin: 32px 0 0; font-size: 26px; line-height: 1.4; color: #64567a; }
  p span { display: block; color: #2a1b3d; font-weight: 500; }
  .mark svg { width: 380px; height: 380px; display: block; }
</style></head>
<body>
  <div>
    <div class="name">Quickben</div>
    <h1>Business apps from one typed config.</h1>
    <p>Open-source framework for Next.js<span>quickben.vialabs.net</span></p>
  </div>
  <div class="mark">${mark}</div>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html, { waitUntil: "networkidle" });
  // Wait for the web fonts, or the card falls back to Georgia and system sans.
  await page.waitForFunction("document.fonts.status === 'loaded'");
  await page.screenshot({ path: new URL("../public/og.png", import.meta.url).pathname });
} finally {
  await browser.close();
}
process.stdout.write("wrote public/og.png\n");
