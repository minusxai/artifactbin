/**
 * The server half of the icon kit: which glyphs a document uses, resolved from the build's
 * lucide data (lib/build-assets/lucide-icons.json) and never from an icon package.
 */
import { describe, it, expect } from 'vitest';
import { iconGlyphKey } from '@/lib/story-ui/icon-contract';
import { FILE_GLYPH_NAMES } from '@/lib/story-ui/file-glyphs';
import { buildGlyphMap, scanIcons, glyphsForNodes } from '@/lib/story-ui/icon-glyphs.server';
import { parseJsx } from '@/lib/jsx';
import { readFileSync } from 'node:fs';

describe('icon glyphs', () => {



  it('collects every icon name a document uses, both spellings', () => {
    const parsed = parseJsx(
      '<div><Icon name="chart-column" /><Card><Icon name="CircleCheck" /></Card><Icon name="chart-column" /></div>',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(scanIcons(parsed.nodes).names.sort()).toEqual(['CircleCheck', 'chart-column']);
  });

  it('ships the fallback whenever a document draws an icon at all', () => {
    // An <Icon> whose name is missing, empty, or a non-static expression resolves to
    // NOTHING by name — and the contract is that a bad name stays visible as the
    // question mark, never a silent hole. So the fallback travels with any document
    // that has an <Icon> in it, and the renderer reaches for it when a name misses.
    const parsed = parseJsx('<div><Icon /><Icon name="" /></div>');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(glyphsForNodes(parsed.nodes))).toContain('CircleQuestionMark');
  });

  it('a <Files> listing carries the six format glyphs, though it names no <Icon>', () => {
    /*
     * THE FOLDER CASE, and the one a unit test of <Files> cannot see: a folder's
     * whole document is `<Files data="$children" />` and there is no <Icon> in
     * it anywhere — the glyph a row draws is chosen from its FORMAT, inside the
     * component. Without this the scan answers {}, `<Icon>` finds an empty map,
     * and every folder listing in the deployment draws no glyph at all while
     * every test stays green.
     */
    const parsed = parseJsx('<Files data="$children" variant="icons" />');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const keys = Object.keys(glyphsForNodes(parsed.nodes));
    for (const name of FILE_GLYPH_NAMES) expect(keys).toContain(iconGlyphKey(name));
    // And the fallback, as for any document that draws an icon at all.
    expect(keys).toContain('CircleQuestionMark');
  });

  it('a document with no icons ships no glyphs at all', () => {
    const parsed = parseJsx('<div><p>prose</p></div>');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(glyphsForNodes(parsed.nodes)).toEqual({});
  });

  it('resolves only what the document asked for', () => {
    // The whole point: a map the size of the document's usage, not of lucide.
    expect(Object.keys(buildGlyphMap(['chart-column']))).toEqual(['ChartColumn']);
  });
});

describe('the server reads icon data from the build, never from the icon packages', () => {
  it('loads no icon package at run time (the production server does not install them)', () => {
    const source = readFileSync(new URL('../icon-glyphs.server.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/lucide-(react|solid)/);
    expect(source).not.toMatch(/createRequire|require\.resolve/);
    expect(source).toContain('lib/build-assets/lucide-icons.json');
  });
});
