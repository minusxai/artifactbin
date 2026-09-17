/**
 * Regenerate the generic og:image every NON-artifact page unfurls with
 * (public/og.png, 1200×630 — the card size scrapers want; anything else is
 * cropped unpredictably). Artifact pages keep their own on-demand export;
 * this card is for the home page, profiles, docs, login — URLs that used to
 * unfurl text-only because the root layout carried no `openGraph` at all.
 *
 * Same rig as generate-theme-previews: the card is a self-contained HTML page
 * shot through headless Chromium, with its subresources (fonts, logo) served
 * out of public/ via page.route — no dev server required. Run after changing
 * the card or the brand:
 *
 *   npm run generate:og
 */
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const OUT_FILE = path.join(PUBLIC_DIR, 'og.png');
const ORIGIN = 'http://og-image.local';

const WIDTH = 1200;
const HEIGHT = 630;

/** Exact hashed names — the files in public/fonts are content-addressed. */
const MONO_400 = '/fonts/jetbrains-mono-latin-400-normal.14425ba9.woff2';
const MONO_700 = '/fonts/jetbrains-mono-latin-700-normal.d0d4e818.woff2';

// Terminal-graphite, dark — the palette in app/globals.css, inlined because
// this page never loads Tailwind.
const HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face { font-family: 'JetBrains Mono'; font-weight: 400; src: url('${MONO_400}') format('woff2'); }
  @font-face { font-family: 'JetBrains Mono'; font-weight: 700; src: url('${MONO_700}') format('woff2'); }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px;
    background-color: #0b0e11;
    /* The app's engineering-paper dot grid, scaled up for the card. */
    background-image: radial-gradient(circle, rgba(46, 57, 71, 0.65) 2px, transparent 2px);
    background-size: 34px 34px;
    font-family: 'JetBrains Mono', monospace;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  .row { display: flex; align-items: center; gap: 64px; }
  .logo { width: 300px; height: 300px; }
  .title { font-size: 84px; font-weight: 700; color: #e6edf3; letter-spacing: -2px; }
  .tagline { margin-top: 28px; font-size: 27px; font-weight: 400; color: #7d8590; line-height: 1.5; }
</style>
</head>
<body>
  <div class="row">
    <img class="logo" src="/logo.png" alt="">
    <div>
      <div class="title">artifactbin</div>
      <div class="tagline">agents publish HTML artifacts, you get a link</div>
    </div>
  </div>
</body>
</html>`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') {
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML });
      }
      try {
        const body = readFileSync(path.join(PUBLIC_DIR, url.pathname.replace(/^\//, '')));
        const type = url.pathname.endsWith('.woff2') ? 'font/woff2'
          : url.pathname.endsWith('.png') ? 'image/png'
          : 'application/octet-stream';
        return route.fulfill({ status: 200, contentType: type, body });
      } catch {
        return route.fulfill({ status: 404, body: '' });
      }
    });
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    writeFileSync(OUT_FILE, await page.screenshot({ type: 'png' }));
    console.log(`wrote ${path.relative(process.cwd(), OUT_FILE)}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
