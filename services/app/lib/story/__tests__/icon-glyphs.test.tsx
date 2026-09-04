/**
 * The data-driven <Icon> must render EXACTLY what lucide's own component renders.
 *
 * `<Icon>` used to be lucide's component behind a name lookup, which meant every
 * document downloaded all ~1600 glyphs. Now the server resolves only the glyphs a
 * document uses and the client renders them from data — but a document is rendered
 * TWICE, to a string on the server and into a live DOM on the client, and those are
 * the same tree only if this component agrees with itself. It also has to agree with
 * what is already STORED: documents published before this change were server-rendered
 * by lucide, and their og captures and static bodies are the old markup.
 *
 * So the equality asserted here is byte-for-byte against lucide, not "looks the
 * same": a differing attribute order or class list is a hydration mismatch, and
 * React answers #418 by discarding the whole server tree and repainting the root
 * (see CLAUDE.md). This is the test that lets the icon set leave the bundle.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { icons } from 'lucide-react';
import { Icon, IconGlyphProvider, ICON_BASE_CLASS } from '@/components/kit/icon';
import { iconGlyphKey } from '@/lib/story-ui/icon-contract';
import { FILE_GLYPH_NAMES } from '@/lib/story-ui/file-glyphs';
import { buildGlyphMap, scanIcons, glyphsForNodes } from '@/lib/story/icon-glyphs';
import { cn } from '@/components/kit/cn';
import { parseJsx } from '@/lib/jsx';

/** Kebab and Pascal spellings, a digit-bearing name, and the unknown-name fallback. */
const NAMES = ['chart-column', 'circle-check', 'CircleCheck', 'grid-2x2', 'triangle-alert'];

/** What lucide itself emits for this name, given the same props the kit passes. */
const lucideMarkup = (name: string, className?: string): string => {
  const Glyph = icons[iconGlyphKey(name) as keyof typeof icons];
  // `data-slot` is what the kit has always passed through to the glyph; lucide's
  // prop type does not model data-* attributes, hence the cast.
  return renderToStaticMarkup(
    createElement(Glyph as React.ComponentType<Record<string, unknown>>, {
      'data-slot': 'icon',
      className: cn(ICON_BASE_CLASS, className),
    }),
  );
};

/** What the kit emits, fed only the resolved glyph data. */
const ourMarkup = (name: string, className?: string): string => {
  const glyphs = buildGlyphMap([name]);
  return renderToStaticMarkup(
    createElement(IconGlyphProvider, { value: glyphs }, createElement(Icon, { name, className })),
  );
};

describe('icon glyphs', () => {
  it.each(NAMES)('renders %s byte-identically to lucide', (name) => {
    expect(ourMarkup(name)).toBe(lucideMarkup(name));
  });

  it('keeps authored classes merging the same way', () => {
    expect(ourMarkup('chart-column', 'size-8 text-red-500')).toBe(
      lucideMarkup('chart-column', 'size-8 text-red-500'),
    );
  });

  it('an unknown name renders the question-mark glyph, never a hole', () => {
    // A typo must stay VISIBLE in the document — the pre-existing contract.
    expect(ourMarkup('no-such-icon-xyz')).toBe(lucideMarkup('circle-question-mark'));
  });

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
