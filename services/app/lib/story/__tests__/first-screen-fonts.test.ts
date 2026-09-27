/**
 * Which faces a document's FIRST SCREEN paints — the ones worth a preload.
 *
 * Both directions are failures a reader pays for. A face the first screen
 * paints but the head does not name is discovered only once the stylesheet is
 * parsed and the text laid out, and the heading repaints when it lands (LCP
 * a second after FCP, measured on production). A face the head names but no
 * text uses is bytes racing the ones that are needed.
 *
 * The answer is read from the parsed nodes on the server (the same body both
 * reader paths render), the theme's display/body/mono families, and the
 * document's own `font-*` metas.
 */
import { describe, expect, it } from 'vitest';
import { firstScreenFonts, readerChromeFonts } from '../first-screen-fonts';
import { storyBodyFor } from '../body';
import { documentFonts } from '../document-fonts';
import { STORY_FONT_THEMES, type StoryFontAsset } from '@/lib/data/story/story-fonts';
import { STORY_THEMES } from '@/lib/data/story/story-themes';

const catalog = STORY_FONT_THEMES.neutral;

/** The latin file of a bundled family at a style — what a preload names. */
function latin(family: string, style: 'normal' | 'italic' = 'normal'): string {
  const upright = catalog.find((a) => a.family === family && a.preload === true);
  if (!upright) throw new Error(`no latin upright for ${family}`);
  if (style === 'normal') return upright.url;
  const italic = catalog.find((a) => a.family === family && a.style === 'italic' && a.unicodeRange === upright.unicodeRange);
  if (!italic) throw new Error(`no latin italic for ${family}`);
  return italic.url;
}

const urls = (faces: readonly StoryFontAsset[]) => [...new Set(faces.map((f) => f.url))].sort();
const expected = (...list: string[]) => [...new Set(list)].sort();

function select(theme: string | null, source: string, importedFaces: StoryFontAsset[] = []) {
  const split = storyBodyFor(source);
  if (!split) throw new Error('fixture did not parse');
  return urls(firstScreenFonts({ theme, nodes: split.body, docFonts: documentFonts(split.content), importedFaces }));
}

const PROSE = '<h1 className="text-4xl font-semibold">Typography holds still</h1><p>The body copy a reader starts reading.</p>';
const EYEBROW = '<p className="font-mono text-xs uppercase">Proposal · 27 Sep</p>';

describe('firstScreenFonts — per theme, from the nodes', () => {
  it('a heading and prose: the display and body faces, one file each, whatever the theme', () => {
    for (const t of STORY_THEMES) {
      expect(select(t.name, PROSE), t.name).toEqual(expected(latin(t.fonts.display), latin(t.fonts.body)));
    }
  });

  it('a mono eyebrow above the heading adds the theme mono face', () => {
    expect(select('industry', EYEBROW + PROSE)).toEqual(expected(latin('Inter'), latin('JetBrains Mono')));
    expect(select('modernist', EYEBROW + PROSE)).toEqual(expected(latin('Inter'), latin('JetBrains Mono')));
    // A theme with no mono family sets code in its body face: nothing extra to fetch.
    expect(select('organic', EYEBROW + PROSE)).toEqual(expected(latin('Noto Serif'), latin('Inter')));
    // Terminal is one family for all three slots: one file, all weights.
    expect(select('terminal', EYEBROW + PROSE)).toEqual([latin('JetBrains Mono')]);
  });

  it('code, pre, kbd and samp are mono', () => {
    for (const tag of ['code', 'pre', 'kbd', 'samp']) {
      expect(select('industry', `<${tag}>x = 1</${tag}>`), tag).toEqual([latin('JetBrains Mono')]);
    }
  });

  it('a face first used below the first screen is not preloaded', () => {
    const long = `<p>${'A long opening paragraph that fills the first screen of the reader. '.repeat(40)}</p>`;
    expect(select('industry', PROSE + long + '<pre><code>SELECT 1</code></pre>')).toEqual([latin('Inter')]);
    expect(select('organic', `<p>${'Words before any heading at all, many of them. '.repeat(50)}</p><h2>Late</h2>`)).toEqual([latin('Inter')]);
  });

  it('only a heading paints the display face; only other text paints the body face', () => {
    expect(select('organic', '<h1>Only a heading</h1>')).toEqual([latin('Noto Serif')]);
    expect(select('organic', '<p>Only prose</p>')).toEqual([latin('Inter')]);
    expect(select('pop', '<section><h2>Nested</h2></section>')).toEqual([latin('Bricolage Grotesque')]);
  });

  it('an explicit font utility decides the face, not the tag', () => {
    // font-sans / font-serif are the system stacks in a story; font-mono is the theme mono.
    expect(select('organic', '<h1 className="font-sans">System</h1>')).toEqual([]);
    expect(select('industry', '<h1 className="font-mono">Mono heading</h1>')).toEqual([latin('JetBrains Mono')]);
  });

  it('italic text asks for the italic file of a family that ships one', () => {
    expect(select('manuscript', '<p>Body with <em>emphasis</em></p>')).toEqual(expected(latin('Noto Serif'), latin('Noto Serif', 'italic')));
    expect(select('manuscript', '<p className="italic">All italic</p>')).toEqual([latin('Noto Serif', 'italic')]);
    // Manuscript sets blockquotes italic in its theme CSS.
    expect(select('manuscript', '<blockquote>Quoted</blockquote>')).toEqual([latin('Noto Serif', 'italic')]);
    expect(select('manuscript', '<h1><i>Slanted</i> title</h1>')).toEqual(expected(latin('Cormorant Garamond'), latin('Cormorant Garamond', 'italic')));
    // Inter ships no italic: the upright file serves the synthesized slant.
    expect(select('modernist', '<p><em>emphasis</em></p>')).toEqual([latin('Inter')]);
    // not-italic undoes it.
    expect(select('manuscript', '<blockquote className="not-italic">Quoted</blockquote>')).toEqual([latin('Noto Serif')]);
  });

  it('a themeless document paints the system stacks: nothing to preload', () => {
    expect(select(null, EYEBROW + PROSE + '<pre>x</pre>')).toEqual([]);
    expect(select('no-such-theme', PROSE)).toEqual([]);
  });

  it('a document font meta replaces its slot, preloaded only when that slot is painted', () => {
    const lobster: StoryFontAsset = { family: 'Lobster', url: '/webfonts/0123456789abcdef0123456789abcdef.woff2', weight: '400', preload: true };
    const lobsterExt: StoryFontAsset = { family: 'Lobster', url: '/webfonts/fedcba9876543210fedcba9876543210.woff2', weight: '400' };
    const head = '<Helmet><meta name="font-display" content="Lobster" /></Helmet>';
    expect(select('organic', head + PROSE, [lobster, lobsterExt])).toEqual(expected(lobster.url, latin('Inter')));
    expect(select(null, head + PROSE, [lobster, lobsterExt])).toEqual([lobster.url]);
    // No heading on the first screen: the display override is declared but never painted.
    expect(select('organic', head + '<p>prose only</p>', [lobster, lobsterExt])).toEqual([latin('Inter')]);
    const body = '<Helmet><meta name="font-body" content="Lobster" /></Helmet>';
    expect(select('manuscript', body + PROSE, [lobster, lobsterExt])).toEqual(expected(latin('Cormorant Garamond'), lobster.url));
  });

  it('text a first screen does not render is not counted', () => {
    expect(select('organic', '<div className="hidden"><h1>Hidden</h1></div><p>Shown</p>')).toEqual([latin('Inter')]);
    expect(select('organic', '<div hidden><h1>Hidden</h1></div><p>Shown</p>')).toEqual([latin('Inter')]);
    expect(select('organic', '<Tabs defaultValue="a"><TabsList><TabsTrigger value="a">One</TabsTrigger></TabsList><TabsContent value="b"><h1>Other tab</h1></TabsContent></Tabs>')).toEqual([latin('Inter')]);
    expect(select('organic', '<Helmet><title>Head only</title></Helmet><h1>Title</h1>')).toEqual([latin('Noto Serif')]);
  });

  it('a Question title is set in the theme mono', () => {
    expect(select('industry', '<Question title="Revenue by region" data="$q" />')).toEqual([latin('JetBrains Mono')]);
  });

  it('never names a face twice, and every face is one the theme or the document declares', () => {
    for (const t of STORY_THEMES) {
      const split = storyBodyFor(EYEBROW + PROSE + '<p><em>x</em><code>y</code></p>')!;
      const faces = firstScreenFonts({ theme: t.name, nodes: split.body, docFonts: documentFonts(split.content), importedFaces: [] });
      expect(faces.length, t.name).toBe(new Set(faces.map((f) => f.url)).size);
      for (const f of faces) expect(STORY_FONT_THEMES[t.name], `${t.name} -> ${f.url}`).toContainEqual(f);
    }
  });
});

describe('readerChromeFonts — the served document\'s own chrome', () => {
  it('is set in the theme mono slot (the body face where a theme has no mono)', () => {
    expect(urls(readerChromeFonts({ theme: 'industry' }))).toEqual([latin('JetBrains Mono')]);
    expect(urls(readerChromeFonts({ theme: 'terminal' }))).toEqual([latin('JetBrains Mono')]);
    expect(urls(readerChromeFonts({ theme: 'organic' }))).toEqual([latin('Inter')]);
    expect(urls(readerChromeFonts({ theme: 'manuscript' }))).toEqual([latin('Noto Serif')]);
    expect(urls(readerChromeFonts({ theme: null }))).toEqual([]);
  });
});
