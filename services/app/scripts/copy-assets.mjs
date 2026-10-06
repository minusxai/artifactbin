#!/usr/bin/env node
// Copies the story fonts into /public out of node_modules — /a/* pages have a
// CSP that only allows our own origin, so these CANNOT come from a CDN. Runs
// on postinstall; public/fonts is gitignored.
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { SYSTEM_FONT_PACKAGES } from './system-font-packages.mjs';

// THE APP'S CWD IS ITS PACKAGE DIR. Every path below is cwd-relative,
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
 * the filename is what makes the app server's `immutable` cache rule on /fonts/* honest;
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
  // ONE variable file per subset — the app shell's own mono face, so a document
  // read inside the app downloads it once — declared at 400 AND 700: a story
  // keeps the static pair's matching (500 sets as 400, 600 as 700; a
  // single-value weight clamps the wght axis to it) instead of every weight
  // in between.
  { family: 'JetBrains Mono', pkg: '@fontsource-variable/jetbrains-mono', file: 'jetbrains-mono-latin-wght-normal.woff2', weight: '400', preload: true },
  { family: 'JetBrains Mono', pkg: '@fontsource-variable/jetbrains-mono', file: 'jetbrains-mono-latin-wght-normal.woff2', weight: '700' },
  { family: 'JetBrains Mono', pkg: '@fontsource-variable/jetbrains-mono', file: 'jetbrains-mono-latin-ext-wght-normal.woff2', weight: '400' },
  { family: 'JetBrains Mono', pkg: '@fontsource-variable/jetbrains-mono', file: 'jetbrains-mono-latin-ext-wght-normal.woff2', weight: '700' },
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

/**
 * THE APP SHELL'S FACES — every @font-face the shell's packages declare (all
 * subsets, their own descriptors), served from the SAME content-addressed
 * files. Vite used to emit these as /assets copies of the very bytes a story
 * names at /fonts, so a document read inside the app fetched Cormorant twice
 * and JetBrains Mono three times. Now both name one URL per file; the shell's
 * stylesheet gets these rules from the manifest at build time (vite.config.mts)
 * and the server preloads the shell's first-screen face (lib/app-fonts).
 * `woff2` only: every browser that runs the app takes it, and public/fonts
 * holds nothing else.
 */
const APP_FONT_CSS = [
  { pkg: '@fontsource-variable/cormorant-garamond', css: 'index.css' },
  { pkg: '@fontsource-variable/jetbrains-mono', css: 'index.css' },
  { pkg: '@fontsource/ibm-plex-sans', css: '400.css' },
  { pkg: '@fontsource/ibm-plex-sans', css: '500.css' },
];

/** The descriptors of each @font-face a package stylesheet declares, with its woff2 file. */
function packageFaces(pkg, css) {
  const text = readFileSync(path.join(packageDir(pkg), css), 'utf8');
  return (text.match(/@font-face\s*\{[^}]*\}/g) ?? []).map((block) => {
    const get = (name) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim();
    const src = block.match(/url\(\.\/files\/([\w.-]+\.woff2)\)\s*format\('([\w-]+)'\)/);
    if (!src) throw new Error(`no woff2 source in ${pkg}/${css}: ${block}`);
    return {
      family: get('font-family').replace(/^'|'$/g, ''), style: get('font-style'), weight: get('font-weight'),
      display: get('font-display'), unicodeRange: get('unicode-range'), stretch: get('font-stretch'), file: src[1], format: src[2],
    };
  });
}

rmSync('public/fonts', { recursive: true, force: true });
mkdirSync('public/fonts', { recursive: true });
/** Copy one package file to its content-addressed name; the same bytes always land at the same URL. */
const copied = new Map();
function copyFont(pkg, file) {
  const bytes = readFileSync(path.join(packageDir(pkg), 'files', file));
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const name = `${file.replace(/\.woff2$/, '')}.${hash}.woff2`;
  if (!copied.has(name)) writeFileSync(`public/fonts/${name}`, bytes);
  copied.set(name, true);
  return `/fonts/${name}`;
}
const families = {};
for (const { family, pkg, file, weight, style, preload } of FONT_FILES) {
  (families[family] ??= []).push({
    family,
    url: copyFont(pkg, file),
    weight,
    ...(style ? { style } : {}),
    unicodeRange: unicodeRangeFor(pkg, file),
    ...(preload ? { preload: true } : {}),
  });
}
const app = APP_FONT_CSS.flatMap(({ pkg, css }) => packageFaces(pkg, css).map(({ file, ...face }) => ({ ...face, url: copyFont(pkg, file) })));
// A design system uses the same package-owned delivery as the original themes. No network
// fetch during install or export: the lockfile owns the binaries, and both readers name them.
const systems = {};
for (const { family, pkg, variable } of SYSTEM_FONT_PACKAGES) {
  const available = readdirSync(packageDir(pkg));
  const normal = available.includes('standard.css') ? 'standard.css' : 'index.css';
  const italic = normal === 'standard.css' ? 'standard-italic.css' : 'wght-italic.css';
  const styles = variable ? [normal, ...(available.includes(italic) ? [italic] : [])]
    : available.filter(file => /^\d+(?:-italic)?\.css$/.test(file));
  const faces = styles.flatMap(css => packageFaces(pkg, css)).filter(face => /-latin(?:-ext)?-/.test(face.file));
  if (!faces.length) throw new Error(`no latin design-system faces for ${pkg}`);
  systems[family] = faces.map(({ file, format: _format, ...face }) => ({ ...face, family, url: copyFont(pkg, file) }));
}
const manifest = { families, app, systems };
// In the Docker builder this runs from npm ci BEFORE `COPY lib ./lib` — the
// tree the manifest lives in does not exist yet (writeFileSync creates no
// directories; the later COPY merges over it without deleting this file).
mkdirSync('lib/data/story', { recursive: true });
writeFileSync('lib/data/story/story-font-manifest.json', JSON.stringify(manifest, null, 2) + '\n');

console.log(`runtime assets copied to public/ (${copied.size} font files)`);
