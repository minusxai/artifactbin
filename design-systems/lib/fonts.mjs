/**
 * Google's font rules for each family and axis string a system uses, as `@font-face` CSS with the
 * files on fonts.gstatic.com. Fetched once into fonts.json (`node scripts/design-systems.mjs fonts`)
 * so every other mode runs offline; a family missing from the cache is an error that names the fix.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CACHE = path.resolve(import.meta.dirname, '../fonts.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let cache = null;
const load = () => (cache ??= JSON.parse(readFileSync(CACHE, 'utf8')));
const key = (family, axes) => `${family}|${axes}`;

/** The cached faces for one family and axis string: latin and latin-ext, every weight and style. */
export function faces(family, axes) {
  const hit = load()[key(family, axes)];
  if (!hit) throw new Error(`fonts.json has no faces for ${family} (${axes}); run: node scripts/design-systems.mjs fonts`);
  return hit;
}

/** Fetch and cache a family's faces from Google Fonts (network; the one mode that needs it). */
export async function fetchFaces(family, axes) {
  const k = key(family, axes);
  const all = load();
  if (all[k]) return all[k];
  const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:${axes}&display=swap`;
  const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const out = [];
  for (const m of css.matchAll(/\/\* (latin(?:-ext)?) \*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    const [, subset, body] = m;
    const d = Object.fromEntries([...body.matchAll(/\s*([a-z-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2]]));
    out.push({ subset, family, style: d['font-style'] ?? 'normal', weight: d['font-weight'] ?? '400', stretch: d['font-stretch'] ?? null, src: /url\(([^)]+)\)/.exec(d.src)[1], range: d['unicode-range'] ?? '' });
  }
  if (!out.length) throw new Error(`no faces for ${family} ${axes}: ${css.slice(0, 200)}`);
  all[k] = out;
  writeFileSync(CACHE, JSON.stringify(all, null, 1));
  return out;
}

const rule = (f, withRange) =>
  `@font-face { font-family: "${f.family}"; font-style: ${f.style}; font-weight: ${f.weight};${f.stretch ? ` font-stretch: ${f.stretch};` : ''} font-display: swap; src: url(${f.src}) format("woff2");${withRange ? ` unicode-range: ${f.range};` : ''} }`;

/** Every cached face as a rule, latin and latin-ext with their unicode ranges: what the pages and the runtime carry. */
export function fontFaceCss(family, axes) {
  return faces(family, axes).map((f) => rule(f, true)).join('\n');
}

/** The latin faces only, without ranges: half the bytes, every weight kept. */
export function fontFaceLatin(family, axes) {
  return faces(family, axes).filter((f) => f.subset === 'latin').map((f) => rule(f, false)).join('\n');
}
