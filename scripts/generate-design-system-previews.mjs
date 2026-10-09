#!/usr/bin/env node
/**
 * Render the shared picker/docs thumbnails from the original design-system covers.
 * npm run generate:design-system-previews [-- slug ...]
 * No app server or added font packages: generation fetches the pinned Google font URLs
 * already recorded in design-systems/fonts.json, caches them in tmp, and serves them
 * locally to Chromium. Only the resulting small WebP files ship to readers.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { ROSTER, REPO, loadSpec } from '../design-systems/lib/pages.mjs';
import { fontFaceCss } from '../design-systems/lib/fonts.mjs';
import { varsMap } from '../design-systems/lib/runtime.mjs';
import { pickerSpecimen } from '../design-systems/lib/picker.mjs';

const ORIGIN = 'http://design-system-previews.local';
const OUT = path.join(REPO, 'services/app/public/design-systems');
const CACHE = path.join(REPO, 'tmp/design-system-preview-fonts');
const escapeHtml = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function previewDocument(spec, mode) {
  const preview = pickerSpecimen(spec);
  const tokens = { ...varsMap(spec, 'light'), ...(mode === 'dark' ? varsMap(spec, 'dark') : {}) };
  const fonts = new Map();
  const fontCss = spec.fonts.map(([family, axes]) => fontFaceCss(family, axes)).join('\n')
    .replace(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g, (_, url) => {
      const local = `/fonts/${createHash('sha256').update(url).digest('hex')}.woff2`;
      fonts.set(local, url);
      return `url(${local})`;
    });
  return { fonts, html: `<!doctype html><html lang="en"><meta charset="utf-8"><style>
${fontCss}
*{box-sizing:border-box}html,body{margin:0;width:240px;height:218px}body{background:transparent}
.card{${Object.entries(tokens).map(([key, value]) => `${key}:${value}`).join(';')};color:var(--foreground);background:var(--ds-cover-bg,var(--background));line-height:1.2}
${preview.css}
.cover{height:144px;overflow:hidden}.cover>svg{display:block;width:100%;height:100%}
.footer{height:74px;padding:12px 14px 14px;background:var(--card);color:var(--card-foreground);border-top:1px solid var(--border)}
.mood{font-family:var(--font-mono);font-size:8px;line-height:16px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted-foreground)}
.name{margin-top:3px;font-family:var(--font-display);font-size:${spec.slug === 'arcade' ? 17 : 25}px;font-weight:700;line-height:1.1}
</style><div class="card" data-design-specimen="${spec.slug}"><div class="cover">${preview.svg}</div><div class="footer"><div class="mood">${escapeHtml(preview.mood)}</div><div class="name">${escapeHtml(spec.name)}</div></div></div></html>` };
}

async function generatePreviews(slugs = ROSTER) {
  for (const slug of slugs) if (!ROSTER.includes(slug)) throw new Error(`Unknown design system: ${slug}`);
  mkdirSync(OUT, { recursive: true });
  mkdirSync(CACHE, { recursive: true });
  const downloads = new Map();
  const fontBytes = (local, url) => {
    if (!downloads.has(local)) downloads.set(local, (async () => {
      const file = path.join(CACHE, path.basename(local));
      if (existsSync(file)) return readFileSync(file);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Font fetch ${response.status}: ${url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.subarray(0, 4).toString() !== 'wOF2') throw new Error(`Invalid font: ${url}`);
      writeFileSync(file, bytes);
      return bytes;
    })());
    return downloads.get(local);
  };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 240, height: 218 }, deviceScaleFactor: 2 });
    for (const slug of slugs) for (const mode of ['light', 'dark']) {
      const { html, fonts } = previewDocument(loadSpec(slug), mode);
      const failures = [];
      await page.route('**/*', async route => {
        const pathname = new URL(route.request().url()).pathname;
        try {
          if (pathname === '/') return await route.fulfill({ contentType: 'text/html', body: html });
          if (fonts.has(pathname)) return await route.fulfill({ contentType: 'font/woff2', body: await fontBytes(pathname, fonts.get(pathname)) });
          throw new Error(`Unexpected preview request: ${route.request().url()}`);
        } catch (error) { failures.push(error); await route.abort(); }
      });
      await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      if (failures.length) throw new AggregateError(failures, `Failed preview: ${slug} ${mode}`);
      const failedFonts = await page.evaluate(() => [...document.fonts].filter(font => font.status === 'error').map(font => font.family));
      if (failedFonts.length) throw new Error(`Unloaded fonts: ${failedFonts.join(', ')}`);
      const file = path.join(OUT, `${slug}${mode === 'dark' ? '-dark' : ''}.webp`);
      const bytes = await sharp(await page.screenshot({ type: 'png' })).webp({ quality: 88, effort: 6 }).toBuffer();
      writeFileSync(file, bytes);
      console.log(`${path.relative(REPO, file)} ${bytes.length} bytes`);
      await page.unroute('**/*');
    }
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await generatePreviews(process.argv.length > 2 ? process.argv.slice(2) : ROSTER);
}
