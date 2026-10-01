/** The built SPA stylesheet is the behavioral seam: it is what the browser loads. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { RolldownOutput } from 'rolldown';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { getStoryFontCss } from '@/lib/data/story/story-fonts';
import { STORY_THEMES } from '@/lib/data/story/story-themes';

interface Built { css: string; assets: Map<string, Uint8Array> }
let built: Promise<Built> | undefined;

/**
 * Build THE STYLESHEET without writing and return it, font faces included, and every emitted asset's
 * bytes. Only web/shell.css is built — the app's real Vite config, plugins and font-face injection,
 * with the entry narrowed by a config hook — because the SPA's script graph contributes no font face:
 * measured, the whole-app build emitted this same shell sheet (identical content hash) plus one
 * face-less chunk sheet, in 2.6s locally and ~12s on CI against 0.6s for the sheet alone.
 */
const SHELL_ONLY = { name: 'app-fonts-shell-only', enforce: 'post' as const, config(config: { build?: { rolldownOptions?: { input?: unknown } } }) {
  config.build!.rolldownOptions!.input = { shell: path.resolve(process.cwd(), 'web/shell.css') };
} };
const appBuild = () => (built ??= build({
  configFile: path.resolve(process.cwd(), '../../vite.config.mts'),
  logLevel: 'warn',
  plugins: [SHELL_ONLY],
  build: { write: false },
}).then((result) => {
  // No `watch` option is supplied, so Vite cannot return its watcher variant.
  const outputs = (Array.isArray(result) ? result : [result]) as RolldownOutput[];
  const items = outputs.flatMap((output) => output.output);
  return {
    css: items.flatMap((item) => item.type === 'asset' && item.fileName.endsWith('.css') ? [String(item.source)] : []).join('\n'),
    assets: new Map(items.flatMap((item) => item.type === 'asset' && typeof item.source !== 'string' ? [[`/${item.fileName}`, item.source] as const] : [])),
  };
}));
const appStylesheet = async () => (await appBuild()).css;

interface Face { family: string; style: string; weight: [number, number]; range: string; urls: string[]; from: string }

/** A unicode-range as sorted numeric intervals — minifiers rewrite `U+0000-00FF` as `U+0-FF` or `U+00??`. */
function normalizeRange(range: string): string {
  if (!range) return 'all';
  return range.split(',').map((part) => {
    const token = part.trim().replace(/^u\+/i, '');
    const [lo, hi = lo] = token.includes('?') ? [token.replace(/\?/g, '0'), token.replace(/\?/g, 'F')] : token.split('-');
    return `${parseInt(lo, 16)}-${parseInt(hi, 16)}`;
  }).sort().join(',');
}

/** Every @font-face in a stylesheet, by the descriptors that decide which file a text run needs. */
function facesOf(css: string, from: string): Face[] {
  return [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(([, body]) => {
    const get = (name: string) => new RegExp(`(?:^|;|\\s)${name}:\\s*([^;]+)`).exec(body)?.[1]?.trim() ?? '';
    const [lo, hi = lo] = (get('font-weight') || '400').split(/\s+/).map(Number);
    return {
      family: get('font-family').replace(/^["']|["']$/g, ''),
      style: get('font-style') || 'normal',
      weight: [lo, hi] as [number, number],
      range: normalizeRange(get('unicode-range')),
      urls: [...body.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]),
      from,
    };
  });
}

/** The family a face belongs to, whatever its package calls it ("JetBrains Mono Variable" is JetBrains Mono). */
const typeface = (family: string) => family.replace(/ Variable$/, '');
const overlaps = (a: Face, b: Face) => a.weight[0] <= b.weight[1] && b.weight[0] <= a.weight[1];

describe('the app stylesheet', () => {
  it('defines the two font variables its own tokens reference', async () => {
    const css = await appStylesheet();
    expect(css).toMatch(/--font-jb-mono:\s*["']JetBrains Mono Variable["']/);
    expect(css).toMatch(/--font-plex-sans:\s*["']IBM Plex Sans["']/);
    expect(css).toMatch(/font-family:\s*var\(--font-mono\)/);
  }, 60_000);

  it('names the families the imported packages actually provide', async () => {
    const css = await appStylesheet();
    const faces = [...css.matchAll(/@font-face\s*\{[^}]+\}/g)].map((match) => match[0]);
    expect(faces.some((face) => /font-family:\s*["']?JetBrains Mono Variable["']?/.test(face))).toBe(true);
    expect(faces.some((face) => /font-family:\s*["']?IBM Plex Sans["']?/.test(face))).toBe(true);
  }, 60_000);
});

/**
 * NO FACE DOWNLOADS TWICE. A document is read inside the app page, so the
 * shell's @font-face rules and the story's sit in one document. Measured on
 * production: JetBrains Mono arrived as three files (the story's static 400
 * and 700, and the shell's variable one) and Cormorant twice (the same bytes
 * at a Vite /assets address and a /fonts one). The browser fetches by URL, so
 * the property is: one URL per file, and one file per face.
 */
describe('the shell and the story name one file per face', () => {
  const storyCss = () => [getStoryFontCss('neutral'), ...STORY_THEMES.map((t) => getStoryFontCss(t.name))].join('\n');

  it('the shell names its faces at /fonts — the content-addressed files the story is served', async () => {
    const shell = facesOf(await appStylesheet(), 'shell');
    expect(shell.length).toBeGreaterThan(0);
    for (const face of shell) {
      for (const url of face.urls) {
        expect(url, `${face.family} ${face.range.slice(0, 16)}`).toMatch(/^\/fonts\/[\w.-]+\.[0-9a-f]{8}\.woff2$/);
        expect(existsSync(path.join(process.cwd(), 'public', url)), url).toBe(true);
      }
    }
  }, 60_000);

  it('no two URLs across the shell and every theme carry the same bytes', async () => {
    const { css, assets } = await appBuild();
    const all = [...facesOf(css, 'shell'), ...facesOf(storyCss(), 'story')];
    const bytesOf = (url: string) => url.startsWith('/fonts/') ? readFileSync(path.join(process.cwd(), 'public', url)) : assets.get(url);
    const urlsByHash = new Map<string, Set<string>>();
    for (const url of new Set(all.flatMap((f) => f.urls).filter((u) => /\.woff2$/.test(u)))) {
      const bytes = bytesOf(url);
      expect(bytes, `no bytes for ${url}`).toBeTruthy();
      const hash = createHash('sha256').update(bytes!).digest('hex');
      urlsByHash.set(hash, (urlsByHash.get(hash) ?? new Set()).add(url));
    }
    const twice = [...urlsByHash.values()].filter((urls) => urls.size > 1).map((urls) => [...urls].join(' = '));
    expect(twice).toEqual([]);
  }, 60_000);

  it('a text run the shell and the story both set resolves to the same file', async () => {
    const shell = facesOf(await appStylesheet(), 'shell').filter((f) => f.urls.some((u) => u.endsWith('.woff2')));
    const story = facesOf(storyCss(), 'story');
    const clashes: string[] = [];
    for (const s of shell) {
      for (const t of story) {
        if (typeface(s.family) !== typeface(t.family) || s.style !== t.style || s.range !== t.range || !overlaps(s, t)) continue;
        const a = s.urls.find((u) => u.endsWith('.woff2')), b = t.urls[0];
        if (a !== b) clashes.push(`${t.family} ${t.style} ${t.weight.join('-')}: shell ${a} vs story ${b}`);
      }
    }
    expect([...new Set(clashes)]).toEqual([]);
  }, 60_000);
});
