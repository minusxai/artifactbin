/**
 * COMPILER COVERAGE (docs/phase2-architecture.md §3, §6): every stored production document compiles.
 *
 * The census on #156's compiler found every refusal in one place: a REGISTERED component with no
 * Solid port (`Slide`, `SlideDeck`, `Icon`, `Table`…) that holds an interactive descendant, holds a
 * `$` value, or sits in a `<For>` row fell to `unported`. Those components are containers with no
 * behaviour of their own, so they compile as a SHELL: today's React kit renders the wrapper at compile
 * time and the children compile into it (islands inside hydrate). An unregistered legacy tag
 * (`<Param>`) renders nothing, exactly as the interpreter does.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { compilePage, generate } from '../compiler';
import { loadCompilerBuild } from '../build.server';
import type { CompileInput } from '../contract';
import { shapeOf, diffShapes } from '@/lib/islands/__tests__/kit-parity';
import { prepareStoryParts } from '@/lib/story/prepare-runtime.server';
import { compileDataflow, prepareCompile } from '@/lib/story/compile-dataflow';
import { dataflowOf, splitHelmet } from '@/lib/story/helmet';
import type { Dataflow } from '@/lib/story/dataflow';
import type { JsxNode } from '@/lib/jsx';
import { parseJsx } from '@/lib/jsx';
import { STORY_UI_COMPONENTS } from '@/lib/story-ui/registry';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import { IconGlyphProvider } from '@/components/kit/icon';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

async function compiledFlow(declared: Dataflow, body: JsxNode[]) {
  const result = compileDataflow(declared, await prepareCompile(declared, async () => null), body);
  if (!result.ok) throw new Error(`fixture dataflow does not compile: ${result.errors.map((e) => e.message).join('; ')}`);
  return result.compiled;
}
async function inputOf(source: string, template: string | null = null): Promise<CompileInput> {
  const { runtime } = await prepareStoryParts({ source, compiledCss: null, theme: null, colorMode: 'light', title: 't', template, refData: {}, assetUrls: new Set() });
  const parsed = parseJsx(source) as { nodes: JsxNode[] };
  const { content, body } = splitHelmet(parsed.nodes);
  const declared = dataflowOf(content);
  const flow = declared.imports.length || declared.values.length || declared.queries.length ? await compiledFlow(declared, body) : null;
  return { nodes: runtime.data.nodes, colorMode: 'light', template, chrome: true, glyphs: runtime.data.glyphs, refData: {}, flow, build: loadCompilerBuild().id };
}
const dom = (html: string) => new JSDOM(`<div id="r">${html}</div>`).window.document.getElementById('r')!;
/** Today's render of the story nodes at `values`, with the version's resolved glyphs (kit-parity's reactRender has none). */
const todays = (input: CompileInput, values: Record<string, unknown>): string =>
  renderToStaticMarkup(createElement(IconGlyphProvider, { value: input.glyphs ?? {} }, createElement(Fragment, null, renderStoryNodes(input.nodes, { values, components: STORY_UI_COMPONENTS }))))
    .replace(/<link rel="preload"[^>]*>/g, '').replace(/<!-- -->/g, '');
/** The compiled column's children against today's render of the same version at the same values. */
const columnParity = (html: string, input: CompileInput, values: Record<string, unknown> = {}): string[] => {
  const column = dom(html).querySelector('.mx-doc')!;
  const react = new JSDOM(`<div>${todays(input, values)}</div>`).window.document.body.firstElementChild!;
  return diffShapes(shapeOf(react), shapeOf(column));
};

const HELMET = '<Helmet><Value name="q" type="string" default="Ada" /><Value name="rows" type="table" value={[{"k":"a","n":1},{"k":"b","n":2}]} /></Helmet>';
/** The three places a wrapper was refused, for one tag. */
const CONTEXTS: Record<string, (tag: string) => string> = {
  'holding an island': (tag) => `${HELMET}<div id="w"><${tag} id="x"><p id="p">{$q}</p></${tag}></div>`,
  'holding a $ value': (tag) => `${HELMET}<div id="w"><${tag} id="x">Hello {$q}</${tag}></div>`,
  'in a row': (tag) => `${HELMET}<div id="w"><For each={$rows} keyBy="k"><${tag} id="x" className="c-{$_row.k}">{$_row.k}</${tag}></For></div>`,
};

describe('every registered component has a compile path', () => {
  // A part that only renders inside its parent (AvatarImage outside Avatar) is not a component a page holds alone;
  // the declaration-only tags are compiled by their owners (For, Column).
  const tags = Object.keys(STORY_UI_COMPONENTS).filter((tag) => !['For', 'Column'].includes(tag));
  for (const [context, markup] of Object.entries(CONTEXTS)) {
    it(`${context}: nothing unported, nothing partial`, async () => {
      const refused: Array<{ tag: string; unported: string[]; partial: string[] }> = [];
      const unpublishable: string[] = [];
      for (const tag of tags) {
        // A shape the publish-time dataflow check refuses is never a stored document.
        let input: CompileInput;
        try { input = await inputOf(markup(tag)); } catch (error) { if (/does not compile/.test(String(error))) { unpublishable.push(tag); continue; } throw error; }
        let generated: ReturnType<typeof generate>;
        try { generated = generate(input); } catch (error) { if (/must be used within/.test(String(error))) continue; throw error; }
        if (generated.unported.length || generated.partial.length) refused.push({ tag, unported: generated.unported, partial: generated.partial });
      }
      expect(refused).toEqual([]);
      expect(unpublishable.filter((tag) => ['SlideDeck', 'Slide', 'Icon', 'Table', 'TableBody', 'TableRow', 'TableCell'].includes(tag))).toEqual([]);
      expect(unpublishable.length, unpublishable.join(', ')).toBeLessThan(tags.length / 4);
    });
  }

  it('the wrappers the census named compile whole through compilePage in every context', async () => {
    for (const tag of ['SlideDeck', 'Slide', 'Icon', 'Table', 'TableBody', 'TableRow', 'TableCell']) {
      for (const [context, markup] of Object.entries(CONTEXTS)) {
        const page = await compilePage(await inputOf(markup(tag)), loadCompilerBuild());
        expect({ tag, context, unported: page.unported, html: page.html.length > 0 }).toEqual({ tag, context, unported: [], html: true });
        expect(page.html).not.toContain('<mx-slot');
        expect(page.html).not.toContain('data-mx-hole');
      }
    }
  });
});

describe('a wrapper is today\'s render around its compiled children', () => {
  it('a slide holding a $ value: the section is served as today, and its text is the declared value', async () => {
    const source = '<Helmet><Value name="who" type="string" default="Ada" /></Helmet><SlideDeck id="d"><Slide title="One" className="py-4" id="s1"><h2 id="h">Hello {$who}</h2></Slide><Slide title="Two" id="s2"><p id="p2">plain</p></Slide></SlideDeck>';
    const input = await inputOf(source, 'deck');
    const page = await compilePage(input, loadCompilerBuild());
    expect(page.unported).toEqual([]);
    expect(page.islands.length).toBeGreaterThan(0);
    expect(columnParity(page.html, input, { who: 'Ada' })).toEqual([]);
    expect(dom(page.html).querySelector('.mx-doc #h')?.textContent).toBe('Hello Ada');
  });

  it('a data-bound deck: the rail thumbnails render as today\'s rail does (declared values, static faces) and the deck behaviour still drives the slides', async () => {
    const source = '<Helmet><Value name="who" type="string" default="Ada" /><Value name="region" type="string" default="NA" /></Helmet><SlideDeck id="d"><Slide title="Cover" id="s1"><h1 id="h">Hello {$who}</h1><Select label="Region" value="$region" options={["NA","EU"]} id="sel" /></Slide><Slide title="Two" id="s2"><Tabs defaultValue="a" id="t"><TabsList id="tl"><TabsTrigger value="a" id="ta">A</TabsTrigger></TabsList><TabsContent value="a" id="tc">a</TabsContent></Tabs></Slide><Slide title="Three" id="s3"><p id="p3">plain</p></Slide></SlideDeck>';
    const page = await compilePage(await inputOf(source, 'deck'), loadCompilerBuild());
    expect(page.unported).toEqual([]);
    expect(page.behaviors).toEqual(['@mx/deck']);
    const root = dom(page.html);
    // What the deck behaviour (@mx/deck startDeck) binds to: the slides in the column, the rail rows, the present bar.
    expect(root.querySelectorAll('.mx-doc [data-mx-slide]')).toHaveLength(3);
    expect(root.querySelectorAll('nav.mx-rail button.mx-rail-row')).toHaveLength(3);
    expect(root.querySelector('.mx-present-count')?.textContent).toBe('1 / 3');
    // The thumbnails are static miniatures at the declared values; nothing in the rail hydrates. One that holds a
    // button (the select's, the tab's) is served inert in a template, which the deck behaviour puts in place:
    // parsed inside the rail row's own button, its first button would close the row.
    const held = [...root.querySelectorAll<HTMLTemplateElement>('.mx-rail-thumb template[data-mx-thumb]')];
    expect(held).toHaveLength(2);
    expect(held[0]!.content.textContent).toContain('Hello Ada');
    expect(held[0]!.content.querySelector('[data-mx-slide] button[aria-label="Region"][disabled]')).toBeTruthy();
    expect(held[1]!.content.querySelector('[role="tablist"] button[role="tab"]')).toBeTruthy();
    expect(root.querySelectorAll('.mx-rail-thumb')[2]!.querySelector('template')).toBeNull();
    expect(root.querySelectorAll('.mx-rail-thumb')[2]!.querySelector('[data-mx-slide] p')?.textContent).toBe('plain');
    expect(root.querySelector('nav.mx-rail [data-hk]')).toBeNull();
    // The column's islands hydrate: the heading's text and the select are live.
    expect(root.querySelector('.mx-doc [data-hk]')).toBeTruthy();
  });

  it('a table whose body repeats rows: the table shell is served as today, the rows compile inside it', async () => {
    const rows = [{ k: 'a', n: 1 }, { k: 'b', n: 2 }];
    for (const body of [
      '<For each={$rows} keyBy="k"><tr id="r"><td id="c">{$_row.k}</td><td>{$_row.n}</td></tr></For>',
      '<For each={$rows} keyBy="k"><TableRow id="r"><TableCell id="c" className="w-{$_row.n}">{$_row.k}</TableCell></TableRow></For>',
    ]) {
      const source = `<Helmet><Value name="rows" type="table" value={${JSON.stringify(rows)}} /></Helmet><Table id="t" className="mt-4"><TableHeader><TableRow><TableHead>K</TableHead></TableRow></TableHeader><TableBody id="tb">${body}</TableBody></Table>`;
      const input = await inputOf(source);
      const page = await compilePage(input, loadCompilerBuild());
      expect(page.unported, body).toEqual([]);
      expect(columnParity(page.html, input, { rows }), body).toEqual([]);
      const table = dom(page.html).querySelector('[data-slot="table-container"] > table#t')!;
      expect(table.querySelectorAll('tbody#tb td').length, body).toBeGreaterThanOrEqual(2);
    }
  });

  it('an icon in a row: the glyph is today\'s, its row attributes are filled per row', async () => {
    const source = '<Helmet><Value name="rows" type="table" value={[{"k":"a"},{"k":"b"}]} /></Helmet><ul id="l"><For each={$rows} keyBy="k"><li id="i"><Icon name="check" className="c-{$_row.k}" id="ic" /> {$_row.k}</li></For></ul>';
    const input = await inputOf(source);
    const page = await compilePage(input, loadCompilerBuild());
    expect(page.unported).toEqual([]);
    expect(columnParity(page.html, input, { rows: [{ k: 'a' }, { k: 'b' }] })).toEqual([]);
    const icons = [...dom(page.html).querySelectorAll('svg[data-slot="icon"]')];
    expect(icons.map((i) => i.getAttribute('class')?.split(' ').filter((c) => c.startsWith('c-')))).toEqual([['c-a'], ['c-b']]);
  });

  it('a static wrapper holding a live control (the W5urWN shape): the table and its cells are served as today, the control is an island', async () => {
    const source = '<Helmet><Value name="on" type="boolean" default={true} /></Helmet><Table id="t"><TableBody><TableRow><TableCell id="c"><Switch label="On" checked="$on" id="sw" /></TableCell></TableRow></TableBody></Table>';
    const page = await compilePage(await inputOf(source), loadCompilerBuild());
    expect(page.unported).toEqual([]);
    expect(page.islands.flatMap((i) => i.kit)).toContain('Switch');
    expect(page.reactStatic).toEqual(expect.arrayContaining(['Table', 'TableBody', 'TableRow', 'TableCell']));
    const cell = dom(page.html).querySelector('td#c')!;
    expect(cell.getAttribute('data-slot')).toBe('table-cell');
    expect(cell.querySelector('[data-hk]')).toBeTruthy();
  });
});

describe('an unregistered legacy tag', () => {
  it('<Param> renders nothing, with or without a $ value, and refuses nothing', async () => {
    const source = '<Helmet><Value name="y" type="string" default="v" /></Helmet><div id="w"><Param name="a" value="$y" /><Param name="b">inner {$y}</Param><p id="after">after</p></div>';
    const input = await inputOf(source);
    const page = await compilePage(input, loadCompilerBuild());
    expect(page.unported).toEqual([]);
    expect(page.islands).toEqual([]);
    expect(columnParity(page.html, input, { y: 'v' })).toEqual([]);
    expect([...dom(page.html).querySelector('#w')!.children].map((c) => c.id)).toEqual(['after']);
  });
});
