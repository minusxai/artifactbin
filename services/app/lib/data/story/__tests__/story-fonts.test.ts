/**
 * Neutral font-asset mechanism: the PLATFORM provides story fonts
 * for jsx stories — a theme registry maps theme name → font assets (family + static asset URL), and
 * `getStoryFontCss` turns the active theme's entries into @font-face CSS. The live view loads fonts
 * by URL (cacheable static assets under /fonts); the data-URI form exists only in the capture-time
 * parsed copy (lib/story-surface/serialize inlines url() → data: at serialization).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { criticalStoryFonts, getStoryFontCss, STORY_FONT_THEMES, STORY_FONTS_ATTR } from '@/lib/data/story/story-fonts';
import { STORY_THEMES } from '@/lib/data/story/story-themes';

const FONT_DIR = path.join(process.cwd(), 'public', 'fonts');
const allAssets = () => Object.values(STORY_FONT_THEMES).flat();
const bytesOf = (url: string) => readFileSync(path.join(FONT_DIR, url.slice('/fonts/'.length)));

/**
 * The WOFF2 table directory, by tag.
 *
 * Parsed by hand because the alternative is trusting the build script, and the
 * property at stake is invisible until it reaches a reader: Inter's @font-face
 * declares `font-weight: 100 900`, which is a lie the moment a rebuild
 * instances the file — every heading silently drops to synthetic bold, and no
 * CSS-level assertion would catch it. Header is 48 bytes, then one entry per
 * table: a flags byte whose low 6 bits index the spec's known-tag table (63 =
 * a 4-byte custom tag follows), then UIntBase128 lengths.
 */
const WOFF2_KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca',
  'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL',
  'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
];

/**
 * Table tags, plus the decompressed table data.
 *
 * The directory is plain bytes but every table's CONTENT sits in one brotli
 * stream that starts right after it — so a feature tag like `tnum`, which is
 * stored as raw ASCII inside GSUB's FeatureList, is only greppable once that
 * stream is inflated. Node's zlib does brotli natively, so this needs no
 * dependency; glyf/loca are the only transformed tables and nothing here
 * looks inside them.
 */
function woff2Parse(buf: Buffer): { tags: string[]; data: Buffer } {
  expect(buf.subarray(0, 4).toString('latin1')).toBe('wOF2');
  const numTables = buf.readUInt16BE(12);
  const totalCompressed = buf.readUInt32BE(20);
  const tags: string[] = [];
  let off = 48;
  const uintBase128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const b = buf[off++];
      value = (value << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    return value;
  };
  for (let i = 0; i < numTables; i++) {
    const flags = buf[off++];
    const index = flags & 0x3f;
    if (index === 0x3f) {
      tags.push(buf.subarray(off, off + 4).toString('latin1'));
      off += 4;
    } else {
      tags.push(WOFF2_KNOWN_TAGS[index]);
    }
    uintBase128(); // origLength
    // glyf/loca carry a transformLength when their transform bits are set;
    // every other table does when transform version != 0.
    const transform = (flags >> 6) & 0x3;
    const tag = tags[tags.length - 1];
    if (tag === 'glyf' || tag === 'loca' ? transform === 0 : transform !== 0) uintBase128();
  }
  return { tags, data: brotliDecompressSync(buf.subarray(off, off + totalCompressed)) };
}

const woff2Tables = (buf: Buffer): string[] => woff2Parse(buf).tags;

describe('getStoryFontCss — theme registry → @font-face CSS', () => {
  it('returns one @font-face rule per registered asset of the neutral default theme', () => {
    const css = getStoryFontCss();
    const rules = css.match(/@font-face/g) ?? [];
    expect(rules.length).toBe(STORY_FONT_THEMES.neutral.length);
  });

  it('every rule points at a same-origin static asset URL (never a data: URI in the live form)', () => {
    const css = getStoryFontCss('neutral');
    for (const asset of STORY_FONT_THEMES.neutral) {
      expect(css).toContain(`url("${asset.url}")`);
      expect(css).toContain(`font-family: "${asset.family}"`);
      expect(asset.url.startsWith('/')).toBe(true); // URL-loaded static asset, not data:
    }
    expect(css).not.toContain('data:');
  });

  it('an unknown theme falls back to the neutral default (mechanism, not a hard failure)', () => {
    expect(getStoryFontCss('no-such-theme')).toBe(getStoryFontCss('neutral'));
  });

  it('carries weight/style descriptors when the registry entry declares them', () => {
    const withStyle = Object.values(STORY_FONT_THEMES).flat().find((a) => a.style);
    // The neutral registry includes an italic serif — the descriptor must survive into the CSS.
    expect(withStyle).toBeTruthy();
    expect(getStoryFontCss()).toContain('font-style: italic');
  });

  it('exports the in-root style node marker attribute for render + save-strip paths', () => {
    expect(STORY_FONTS_ATTR).toBe('data-mx-fonts');
  });
});

// Per-theme font assets — every registry theme maps its display/body (and mono)
// families to bundled public/fonts assets; getStoryFontCss(theme) returns that theme's set.
describe('per-theme font assets (Story_Design_V2 §5)', () => {
  it('every STORY_THEMES entry has a font-asset set covering its families', () => {
    for (const t of STORY_THEMES) {
      const assets = STORY_FONT_THEMES[t.name];
      expect(assets, t.name).toBeTruthy();
      const families = new Set(assets.map(a => a.family));
      expect(families.has(t.fonts.display), `${t.name} display ${t.fonts.display}`).toBe(true);
      expect(families.has(t.fonts.body), `${t.name} body ${t.fonts.body}`).toBe(true);
      if (t.fonts.mono) expect(families.has(t.fonts.mono), `${t.name} mono`).toBe(true);
    }
  });

  it('getStoryFontCss(theme) returns @font-face rules for that theme\'s families', () => {
    const css = getStoryFontCss('manuscript');
    expect(css).toContain('@font-face');
    expect(css).toContain('"Noto Serif"');
    // Manuscript is serif-only — a neutral-fallback answer (which carries Inter) would be wrong.
    expect(css).not.toContain('"Inter"');
    // URL form only — data-URIs are capture-time-spliced, never in the live form.
    expect(css).not.toContain('data:');
    expect(css).toMatch(/url\("\/fonts\//);
  });

  it('every registered asset points at a real bundled file under public/fonts', () => {
    const files = new Set(readdirSync(path.join(process.cwd(), 'public', 'fonts')));
    for (const assets of Object.values(STORY_FONT_THEMES)) {
      for (const a of assets) {
        expect(a.url.startsWith('/fonts/'), a.url).toBe(true);
        expect(files.has(a.url.slice('/fonts/'.length)), a.url).toBe(true);
      }
    }
  });
});

/**
 * The bundled assets are the delivery half of the fix: a reader used to wait
 * ~1.1s for a 1.8MB TTF before the document stopped rendering in a fallback
 * face. Each property below is one thing that made that slow, pinned so a
 * later rebuild can't quietly undo it.
 */
describe('bundled font assets are subset WOFF2, and safe to serve immutable', () => {
  it('every registered asset is WOFF2 — a TTF is 5-25x the bytes for the same glyphs', () => {
    for (const a of allAssets()) {
      expect(a.url.endsWith('.woff2'), a.url).toBe(true);
    }
  });

  it('no TTF is left in public/fonts', () => {
    const stale = readdirSync(FONT_DIR).filter((f) => !f.endsWith('.woff2'));
    expect(stale, `unexpected files in public/fonts: ${stale.join(', ')}`).toEqual([]);
  });

  it('declares format("woff2") so a browser can skip a face it cannot use', () => {
    expect(getStoryFontCss()).toContain('format("woff2")');
  });

  /**
   * next.config.ts serves /fonts/* as `immutable`, which is a promise that the
   * bytes at a URL never change. The content hash in the filename is what
   * makes that true; if a file is replaced without renaming it, the promise
   * breaks and readers keep a stale font forever.
   */
  it('every filename carries the sha256 prefix of its own bytes', () => {
    for (const a of allAssets()) {
      const name = a.url.slice('/fonts/'.length);
      const declared = /\.([0-9a-f]{8})\.woff2$/.exec(name)?.[1];
      expect(declared, `${name} has no content hash`).toBeTruthy();
      const actual = createHash('sha256').update(bytesOf(a.url)).digest('hex').slice(0, 8);
      expect(actual, `${name} does not match its bytes — regenerate via scripts/copy-assets.mjs (postinstall)`).toBe(declared);
    }
  });

  it('keeps each asset small enough to arrive before first paint', () => {
    for (const a of allAssets()) {
      const kb = bytesOf(a.url).byteLength / 1024;
      expect(kb, `${a.url} is ${Math.round(kb)}KB`).toBeLessThan(300);
    }
  });

  /**
   * A weight RANGE descriptor is only honest if the file can actually
   * interpolate. Instancing Inter would still render — as synthetic bold at
   * every weight above 400, on every heading of every Inter theme.
   */
  it('an asset declaring a weight range is a real variable font', () => {
    const ranged = allAssets().filter((a) => a.weight?.includes(' '));
    expect(ranged.length, 'expected at least one variable asset').toBeGreaterThan(0);
    for (const a of ranged) {
      expect(woff2Tables(bytesOf(a.url)), a.url).toContain('fvar');
    }
  });

  it('an asset declaring a single weight carries no variation tables to pay for', () => {
    for (const a of allAssets().filter((x) => x.weight && !x.weight.includes(' '))) {
      expect(woff2Tables(bytesOf(a.url)), a.url).not.toContain('fvar');
    }
  });

  /**
   * story-themes.ts sets `font-variant-numeric: tabular-nums` on tables, which
   * is inert without the `tnum` feature — and `tnum` is exactly what
   * pyftsubset's DEFAULT feature set drops. Cheapest possible check that the
   * build kept `--layout-features='*'`: the tag survives in the bytes.
   */
  it('keeps the tabular-numerals feature the table styles depend on', () => {
    // Mono is exempt: every digit is already one advance wide, and upstream
    // JetBrains Mono ships no `tnum` to preserve. Per-script subset files are
    // judged only where the DIGITS live — a latin-ext file contains no 0-9,
    // so it has no tnum to carry and none is needed from it.
    const servesDigits = (a: { unicodeRange?: string }) =>
      !a.unicodeRange || a.unicodeRange.split(',').some((r) => {
        const m = /^U\+([0-9a-f]+)(?:-([0-9a-f]+))?$/i.exec(r.trim());
        if (!m) return false;
        const lo = parseInt(m[1], 16);
        const hi = m[2] ? parseInt(m[2], 16) : lo;
        return lo <= 0x30 && hi >= 0x39;
      });
    const digitFiles = allAssets().filter((a) => a.family !== 'JetBrains Mono' && servesDigits(a));
    expect(digitFiles.length).toBeGreaterThan(0);
    for (const a of digitFiles) {
      const { data } = woff2Parse(bytesOf(a.url));
      expect(data.includes(Buffer.from('tnum', 'latin1')), `${a.url} lost tnum`).toBe(true);
    }
  });
});

describe('criticalStoryFonts — what earns a preload in the document head', () => {
  it('is always a non-empty subset of the faces the theme actually declares', () => {
    for (const theme of [...STORY_THEMES.map((t) => t.name), 'neutral', 'no-such-theme']) {
      const declared = STORY_FONT_THEMES[theme] ?? STORY_FONT_THEMES.neutral;
      const critical = criticalStoryFonts(theme);
      expect(critical.length, theme).toBeGreaterThan(0);
      for (const a of critical) expect(declared, `${theme} -> ${a.url}`).toContainEqual(a);
    }
  });

  it('carries only the display and body families — never mono', () => {
    for (const t of STORY_THEMES) {
      const families = new Set(criticalStoryFonts(t.name).map((a) => a.family));
      expect([...families].sort(), t.name).toEqual([...new Set([t.fonts.display, t.fonts.body])].sort());
    }
  });

  it('skips italic — it sets a phrase, not a page', () => {
    for (const t of STORY_THEMES) {
      expect(criticalStoryFonts(t.name).some((a) => a.style === 'italic'), t.name).toBe(false);
    }
  });

  it('stays small: preloading a face the page never paints just races the one it does', () => {
    for (const t of STORY_THEMES) {
      expect(criticalStoryFonts(t.name).length, t.name).toBeLessThanOrEqual(2);
    }
  });

  it('answers for an unknown theme with the neutral default sans', () => {
    expect(criticalStoryFonts('no-such-theme')).toEqual(criticalStoryFonts('neutral'));
    expect(criticalStoryFonts('neutral').map((a) => a.family)).toEqual(['Inter']);
  });
});
