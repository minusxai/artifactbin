/**
 * Regenerate the theme preview PNGs the picker cards show
 * (public/story-themes/<name>.png light, <name>-dark.png dark — 12 files).
 *
 * Drives lib/data/story/theme-preview through headless Chromium (playwright,
 * already a dependency via lib/export): each document is served from a fake
 * origin via page.route — page.setContent alone cannot resolve the /fonts/**
 * URLs the document preloads, and a dev server must not be a prerequisite for
 * regenerating design assets. Run after any registry change:
 *
 *   npm run generate:theme-previews
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { STORY_THEMES } from '@/lib/data/story/story-themes';
// YAML imports are registered by scripts/register-yaml.cjs (the build:plugin precedent).
import { buildThemePreviewDocument } from '@/lib/data/story/theme-preview';

const OUT_DIR = path.join(process.cwd(), 'public', 'story-themes');
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const ORIGIN = 'http://theme-previews.local';

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      // The picker renders 640×400 (16:10); shoot @2x for crisp cards.
      viewport: { width: 640, height: 400 },
      deviceScaleFactor: 2,
    });
    for (const t of STORY_THEMES) {
      for (const mode of ['light', 'dark'] as const) {
        const html = await buildThemePreviewDocument(t.name, mode);
        await page.route('**/*', async (route) => {
          const url = new URL(route.request().url());
          if (url.pathname === '/') {
            return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
          }
          // The document's own subresources (font preloads) out of public/.
          try {
            const body = readFileSync(path.join(PUBLIC_DIR, url.pathname.replace(/^\//, '')));
            const type = url.pathname.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream';
            return route.fulfill({ status: 200, contentType: type, body });
          } catch {
            return route.fulfill({ status: 404, body: '' });
          }
        });
        await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        const file = path.join(OUT_DIR, `${t.name}${mode === 'dark' ? '-dark' : ''}.png`);
        writeFileSync(file, await page.screenshot({ type: 'png' }));
        await page.unroute('**/*');
        console.log(`wrote ${path.relative(process.cwd(), file)}`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
