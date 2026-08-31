#!/usr/bin/env node
// Copies the story fonts into /public out of node_modules — /a/* pages have a
// CSP that only allows our own origin, so these CANNOT come from a CDN. Runs
// on postinstall; public/fonts is gitignored.
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

// THE APP'S CWD IS ITS PACKAGE DIR (P3 §B.4). Every path below is cwd-relative,
// and CI runs this script from the repo root — so this process pins its own cwd
// to the package it fills, and callers may run it from anywhere.
process.chdir(path.resolve(import.meta.dirname, '..'));

import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const packageDir = (pkg) => path.dirname(require.resolve(`${pkg}/package.json`));

/*
 * STORY FONTS — from @fontsource packages (the Google Fonts binaries,
 * versioned through package-lock) into content-hashed files under
 * public/fonts, plus a manifest lib/data/story/story-fonts reads. The hash in
 * the filename is what makes next.config's `immutable` on /fonts/* honest;
 * the manifest is generated (gitignored) so the registry can never name a
 * file that does not exist.
 *
 * Per family: the `latin` file (preloaded — it is what body text needs) and
 * `latin-ext` (fetched lazily via its unicode-range when a document actually
 * uses those code points). Axis sets: `standard` keeps every variable axis
 * the family ships (Inter opsz+wght, Bricolage opsz+wdth+wght) — instancing
 * would turn every heavy heading into synthetic bold.
 *
 * The PROPERTIES this pipeline must preserve (tnum for tabular columns, fvar
 * for weight ranges, per-file content hashes, <300KB) are pinned by
 * lib/data/story/__tests__/story-fonts.test.ts against the produced bytes —
 * a fontsource upgrade that strips a feature fails there, not on a reader.
 */
const FONT_FILES = [
  { family: 'Inter', pkg: '@fontsource-variable/inter', file: 'inter-latin-standard-normal.woff2', weight: '100 900', preload: true },
  { family: 'Inter', pkg: '@fontsource-variable/inter', file: 'inter-latin-ext-standard-normal.woff2', weight: '100 900' },
  { family: 'JetBrains Mono', pkg: '@fontsource/jetbrains-mono', file: 'jetbrains-mono-latin-400-normal.woff2', weight: '400', preload: true },
  { family: 'JetBrains Mono', pkg: '@fontsource/jetbrains-mono', file: 'jetbrains-mono-latin-ext-400-normal.woff2', weight: '400' },
  { family: 'JetBrains Mono', pkg: '@fontsource/jetbrains-mono', file: 'jetbrains-mono-latin-700-normal.woff2', weight: '700' },
  { family: 'JetBrains Mono', pkg: '@fontsource/jetbrains-mono', file: 'jetbrains-mono-latin-ext-700-normal.woff2', weight: '700' },
  { family: 'Noto Serif', pkg: '@fontsource/noto-serif', file: 'noto-serif-latin-400-normal.woff2', weight: '400', preload: true },
  { family: 'Noto Serif', pkg: '@fontsource/noto-serif', file: 'noto-serif-latin-ext-400-normal.woff2', weight: '400' },
  { family: 'Noto Serif', pkg: '@fontsource/noto-serif', file: 'noto-serif-latin-400-italic.woff2', weight: '400', style: 'italic' },
  { family: 'Noto Serif', pkg: '@fontsource/noto-serif', file: 'noto-serif-latin-ext-400-italic.woff2', weight: '400', style: 'italic' },
  { family: 'Cormorant Garamond', pkg: '@fontsource-variable/cormorant-garamond', file: 'cormorant-garamond-latin-wght-normal.woff2', weight: '300 700', preload: true },
  { family: 'Cormorant Garamond', pkg: '@fontsource-variable/cormorant-garamond', file: 'cormorant-garamond-latin-ext-wght-normal.woff2', weight: '300 700' },
  { family: 'Cormorant Garamond', pkg: '@fontsource-variable/cormorant-garamond', file: 'cormorant-garamond-latin-wght-italic.woff2', weight: '300 700', style: 'italic' },
  { family: 'Cormorant Garamond', pkg: '@fontsource-variable/cormorant-garamond', file: 'cormorant-garamond-latin-ext-wght-italic.woff2', weight: '300 700', style: 'italic' },
  { family: 'Bricolage Grotesque', pkg: '@fontsource-variable/bricolage-grotesque', file: 'bricolage-grotesque-latin-standard-normal.woff2', weight: '200 800', preload: true },
  { family: 'Bricolage Grotesque', pkg: '@fontsource-variable/bricolage-grotesque', file: 'bricolage-grotesque-latin-ext-standard-normal.woff2', weight: '200 800' },
];

/**
 * The unicode-range for a subset file, read from the package's own CSS — the
 * declaration that makes two same-family @font-face rules lazy (the browser
 * fetches only the file whose range the page's text hits). Parsed rather than
 * hardcoded so a fontsource update that reshuffles ranges cannot go stale.
 */
function unicodeRangeFor(pkg, file) {
  const dir = packageDir(pkg);
  for (const css of readdirSync(dir).filter((f) => f.endsWith('.css'))) {
    const text = readFileSync(`${dir}/${css}`, 'utf8');
    for (const block of text.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
      if (block.includes(`/${file})`)) {
        const range = block.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
        if (range) return range;
      }
    }
  }
  throw new Error(`no unicode-range found for ${pkg}/${file}`);
}

rmSync('public/fonts', { recursive: true, force: true });
mkdirSync('public/fonts', { recursive: true });
const manifest = {};
for (const { family, pkg, file, weight, style, preload } of FONT_FILES) {
  const bytes = readFileSync(path.join(packageDir(pkg), 'files', file));
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const name = `${file.replace(/\.woff2$/, '')}.${hash}.woff2`;
  writeFileSync(`public/fonts/${name}`, bytes);
  (manifest[family] ??= []).push({
    family,
    url: `/fonts/${name}`,
    weight,
    ...(style ? { style } : {}),
    unicodeRange: unicodeRangeFor(pkg, file),
    ...(preload ? { preload: true } : {}),
  });
}
// In the Docker builder this runs from npm ci BEFORE `COPY lib ./lib` — the
// tree the manifest lives in does not exist yet (writeFileSync creates no
// directories; the later COPY merges over it without deleting this file).
mkdirSync('lib/data/story', { recursive: true });
writeFileSync('lib/data/story/story-font-manifest.json', JSON.stringify(manifest, null, 2) + '\n');

console.log(`runtime assets copied to public/ (${FONT_FILES.length} font files)`);
