/**
 * COMPILER COVERAGE (docs/phase2-architecture.md §3, §6): every stored production document compiles.
 *
 * The census on #156's compiler found every refusal in one place: a REGISTERED component with no
 * Solid port (`Slide`, `SlideDeck`, `Icon`, `Table`…) that holds an interactive descendant, holds a
 * `$` value, or sits in a `<For>` row fell to `unported`.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { compilePage, declaredValues, generate } from '../compiler';
import { loadCompilerBuild } from '../build.server';
import type { CompileInput } from '../contract';
import { shapeOf, diffShapes, applyCurrentLayoutContracts } from '@/lib/islands/__tests__/kit-parity';
import { prepareStoryParts } from '@/lib/publish/prepared/prepare-runtime.server';
import { compileDataflow, prepareCompile } from '@/lib/dataflow/compile-dataflow';
import { dataflowOf, splitHelmet } from '@/lib/document/helmet';
import type { Dataflow } from '@/lib/dataflow/dataflow';
import type { JsxNode } from '@/lib/jsx';
import { parseJsx } from '@/lib/jsx';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { STORY_UI_COMPONENT_NAME_LIST } from '@/lib/jsx/component-names';
import { COMPILED_PARITY_FIXTURES } from '../../../../../scripts/fixtures/compiled-parity/index.mjs';
import { buildGlyphMap } from '@/lib/story-ui/icon-glyphs.server';
import { loadSsrModule } from '../bundle.server';
import { createModuleStore } from '../modules.server';

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
/**
 * The React reader's render of the story nodes at `values`, with the version's resolved glyphs — recorded
 * (./fixtures/react-coverage-oracle.json.gz) from the retired interpreter before React left the app.
 */
let oracle: Record<string, string> | null = null;
const todays = (input: CompileInput, values: Record<string, unknown>): string => {
  oracle ??= JSON.parse(gunzipSync(readFileSync(path.join(import.meta.dirname, 'fixtures', 'react-coverage-oracle.json.gz'))).toString('utf8')) as Record<string, string>;
  const key = JSON.stringify({ nodes: input.nodes, values, glyphs: input.glyphs ?? {} });
  const recorded = oracle[key];
  if (recorded === undefined) throw new Error('no recorded React render for these nodes and values');
  return applyCurrentLayoutContracts(recorded);
};
/** The compiled column's children against today's render of the same version at the same values. */
const columnParity = (html: string, input: CompileInput, values: Record<string, unknown> = {}, drop: string[] = []): string[] => {
  const column = dom(html).querySelector('.mx-doc')!;
  const react = new JSDOM(`<div>${todays(input, values)}</div>`).window.document.body.firstElementChild!;
  for (const root of [column, react]) for (const id of drop) root.querySelector(`#${id}`)?.remove();
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
  const tags = [...STORY_UI_COMPONENT_NAME_LIST].filter((tag) => !['For', 'Column'].includes(tag));
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

  it('bounds each slide to the deck track while preserving its viewport-height recipe', async () => {
    const source = '<Helmet><Query name="plot">{`select 1 as amount`}</Query></Helmet><SlideDeck id="d">'
      + Array.from({ length: 5 }, (_, i) => `<Slide title="Slide ${i + 1}" id="s${i + 1}"><h2>Slide ${i + 1}</h2></Slide>`).join('')
      + '<Slide title="Chart" id="s6"><Question data="$plot" viz={{"kind":"vega-lite","spec":{"mark":{"type":"bar"}}}} height="320px" /></Slide></SlideDeck>';
    const page = await compilePage(await inputOf(source, 'deck'), loadCompilerBuild());
    expect(page.unported).toEqual([]);
    const slides = [...dom(page.html).querySelectorAll<HTMLElement>('.mx-doc [data-mx-slide]')];
    expect(slides).toHaveLength(6);
    for (const slide of slides) {
      expect(slide.classList.contains('w-full')).toBe(true);
      expect(slide.classList.contains('min-w-0')).toBe(true);
      expect(slide.classList.contains('min-h-[var(--mx-vh,760px)]')).toBe(true);
    }
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
    expect(page.reactStatic).toEqual([]);
    expect(page.kit.skeleton).toEqual(expect.arrayContaining(['Table', 'TableBody', 'TableRow', 'TableCell']));
    const cell = dom(page.html).querySelector('td#c')!;
    expect(cell.getAttribute('data-slot')).toBe('table-cell');
    expect(cell.querySelector('[data-hk]')).toBeTruthy();
  });
});

describe('the compiled-parity gate\'s wrapper fixtures', () => {
  const ROWS = [{ k: 'a', n: 1, on: true }, { k: 'b', n: 2, on: false }, { k: 'c', n: 3, on: true }];
  for (const fixture of COMPILED_PARITY_FIXTURES as Array<{ key: string; markup: string; template: string | null }>) {
    it(`${fixture.key}: compiles whole, and its column is today's render at the declared values`, async () => {
      const input = await inputOf(fixture.markup, fixture.template);
      const page = await compilePage(input, loadCompilerBuild());
      expect(page.unported).toEqual([]);
      expect(page.islands.length).toBeGreaterThan(0);
      // The live controls are the kit's (their parity with today's live reader is the kit tests' and the gate's); the
      // reference here is the static interpreter, which draws their disabled faces.
      expect(columnParity(page.html, input, { ...declaredValues(input.flow), rows: ROWS }, ['dk5', 'tb17'])).toEqual([]);
    });
  }
});

describe('reactive shells match the React reader', () => {
  it('keeps native boolean attributes live at declared values and in rows', async () => {
    const source = '<Helmet><Value name="on" type="boolean" default={true} /><Value name="rows" type="table" value={[{"k":"a","off":false},{"k":"b","off":true}]} /></Helmet><div><details id="details" open={$on}><summary>More</summary></details><p id="hidden" hidden={!$on}>Hi</p><For each={$rows} keyBy="k"><button id="row" disabled={$_row.off}>{$_row.k}</button></For></div>';
    const input = await inputOf(source);
    const page = await compilePage(input, loadCompilerBuild());
    expect(columnParity(page.html, input, { on: true, rows: [{ k: 'a', off: false }, { k: 'b', off: true }] })).toEqual([]);
    expect(dom(page.html).querySelector('#details')?.hasAttribute('open')).toBe(true);
    expect([...dom(page.html).querySelectorAll('.mx-doc button')].map((b) => b.hasAttribute('disabled'))).toEqual([false, true]);
    expect(generate(input).islands).toContain('rt.expr');
  });

  it('substitutes row classes before merging and row leaf props before rendering', async () => {
    const rows = [{ k: 'a', shade: 'red', p: 20 }, { k: 'b', shade: 'blue', p: 80 }];
    const source = `<Helmet><Value name="rows" type="table" value={${JSON.stringify(rows)}} /></Helmet><For each={$rows} keyBy="k"><div><Badge id="badge" className="bg-red-500 bg-{$_row.shade}">{$_row.k}</Badge><Progress id="progress" value="{$_row.p}" /></div></For>`;
    const input = await inputOf(source);
    const page = await compilePage(input, loadCompilerBuild());
    expect(columnParity(page.html, input, { rows })).toEqual([]);
  });

  it('merges a React shell class after each row substitutes its utility', async () => {
    const rows = [{ k: 'a', pad: 4 }, { k: 'b', pad: 8 }];
    const source = `<Helmet><Value name="rows" type="table" value={${JSON.stringify(rows)}} /></Helmet><Table><TableBody><For each={$rows} keyBy="k"><TableRow><TableCell id="cell" className="p-{$_row.pad}">{$_row.k}</TableCell></TableRow></For></TableBody></Table>`;
    const input = await inputOf(source);
    const page = await compilePage(input, loadCompilerBuild());
    expect(columnParity(page.html, input, { rows })).toEqual([]);
  });

  it('resolves the glyph named by each declared row', async () => {
    const rows = [{ k: 'a', icon: 'check' }, { k: 'b', icon: 'x' }];
    const source = `<Helmet><Value name="rows" type="table" value={${JSON.stringify(rows)}} /></Helmet><For each={$rows} keyBy="k"><Icon id="icon" name="{$_row.icon}" /></For>`;
    const input = { ...(await inputOf(source)), glyphs: buildGlyphMap(['check', 'x']) };
    const page = await compilePage(input, loadCompilerBuild());
    expect(columnParity(page.html, input, { rows })).toEqual([]);
    expect([...dom(page.html).querySelectorAll('svg[data-slot="icon"]')]).toHaveLength(2);
    const code = new TextDecoder().decode((await createModuleStore().get(page.module!.sha))!);
    expect(code).toContain('data-mx-island-literals');
    expect(dom(page.html).querySelector('script[data-mx-island-literals]')?.textContent).toContain('glyphs-');
  });

  it('renders a live rail miniature from the current values', async () => {
    const source = '<Helmet><Value name="who" type="string" default="Ada" /></Helmet><SlideDeck><Slide title="One"><h1 id="who">Hello {$who}</h1></Slide><Slide title="Two"><p>Two</p></Slide><Slide title="Three"><p>Three</p></Slide></SlideDeck>';
    const input = await inputOf(source, 'deck');
    const page = await compilePage(input, loadCompilerBuild());
    const rail = dom(page.html).querySelector('.mx-rail-thumb')!;
    expect(rail.textContent).toContain('Hello Ada');
    expect(page.behaviors).toContain('@mx/deck');
    expect(page.module, 'the rail needs the data store to follow value changes').not.toBeNull();
    const ssr = await loadSsrModule(page.ssr!);
    const changed = ssr.render({ values: { who: 'Grace' }, results: null, mermaidImages: {}, drawings: {} });
    expect(dom(changed).querySelector('.mx-rail-thumb')?.textContent).toContain('Hello Grace');
  });
});

describe('the static part of a large document', () => {
  it('renders a large static subtree through the Solid skeleton', async () => {
    const rows = Array.from({ length: 400 }, (_, i) => `<TableRow><TableCell className="font-mono">row ${i} &amp; "q" 'a' &lt;b&gt;</TableCell><TableCell>${i}</TableCell></TableRow>`).join('');
    const source = `<Helmet><Value name="q" type="string" default="Ada" /></Helmet><div id="w"><h1 id="h">Big</h1><Table id="t"><TableBody>${rows}</TableBody></Table><p id="live">Hello {$q}</p><mx-static data-i="0" id="own"></mx-static></div>`;
    const input = await inputOf(source);
    const generated = generate(input);
    expect(generated.skeleton).toContain('row 399');
    expect(generated.skeleton).not.toContain('<mx-static data-i=');
    expect(generated.kit.skeleton).toEqual(expect.arrayContaining(['Table', 'TableBody', 'TableRow', 'TableCell']));
    expect(generated.reactStatic).toEqual([]);
    const page = await compilePage(input, loadCompilerBuild());
    expect(page.html).not.toMatch(/<mx-static data-i="\d+"><\/mx-static>/);
    // An author's own element of that name is theirs, not a placeholder.
    expect(dom(page.html).querySelector('mx-static#own')).toBeTruthy();
    expect(dom(page.html).querySelectorAll('#t tr')).toHaveLength(400);
    expect(columnParity(page.html, input, { q: 'Ada' })).toEqual([]);
  });
});

describe('an unregistered legacy tag', () => {
  it('<Param> is reported as unported by the compiler', async () => {
    const source = '<Helmet><Value name="y" type="string" default="v" /></Helmet><div id="w"><Param name="a" value="$y" /><Param name="b">inner {$y}</Param><p id="after">after</p></div>';
    const input = await inputOf(source);
    const page = await compilePage(input, loadCompilerBuild());
    // The deleted legacy unregistered-tag rule cannot silently discard stored author content.
    expect(page.unported).toEqual(['Param']);
    expect(page.html).toBe('');
    expect(page.module).toBeNull();
  });
});
