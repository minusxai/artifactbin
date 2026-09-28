// DESTINATION: services/app/lib/compiled-page/__tests__/compiler.test.ts
/**
 * THE COMPILER (docs/phase2-architecture.md §2.1, §3, §9; contract CompilePage): one prepared version
 * → static HTML with islands spliced in, one per-document module, island refs, the plan and the
 * hints. Proven on the page-speed fixtures and with the codegen-safety harness. Needs the shared
 * island build (the toolchain track's global setup builds it beside the story runtime).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { compilePage, compileSources } from '../compiler';
import { loadCompilerBuild } from '../build.server';
import { malformedTagDocument, namedHazardsDocument, structureIndependent } from '../codegen-safety';
import { CHART_SLOT_ATTR, type CompileInput } from '../contract';
import { prepareStoryParts } from '@/lib/story/prepare-runtime.server';
import { compileDataflow } from '@/lib/story/compile-dataflow';
import { parseDataflow } from '@/lib/story/dataflow';
import { parseJsx } from '@/lib/jsx';

const FIXTURES = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

async function inputOf(source: string, template: string | null = null): Promise<CompileInput> {
  const { runtime } = await prepareStoryParts({ source, compiledCss: null, theme: null, colorMode: 'light', title: 't', template, refData: {}, assetUrls: new Set() });
  const parsed = parseJsx(source) as { nodes: import('@/lib/jsx').JsxNode[] };
  const declared = parseDataflow(parsed.nodes);
  const flow = declared.imports.length || declared.values.length || declared.queries.length ? compileDataflow(declared, { imports: {} } as never, parsed.nodes).flow : null;
  return { nodes: runtime.data.nodes, colorMode: 'light', template, chrome: true, glyphs: runtime.data.glyphs, refData: {}, flow, build: loadCompilerBuild().id };
}
const dom = (html: string) => new JSDOM(`<div id="r">${html}</div>`).window.document.getElementById('r')!;

describe('compilePage', () => {
  it('prose: static HTML only — no islands, no module, no slot left behind', async () => {
    const page = await compilePage(await inputOf(fixture('prose.jsx')), loadCompilerBuild());
    expect(page.islands).toEqual([]);
    expect(page.module).toBeNull();
    expect(page.html).not.toContain('<mx-slot');
    expect(dom(page.html).querySelector('h1')?.textContent).toBe('A plain prose document');
    expect(page.unported).toEqual([]);
    expect(page.build).toBe(loadCompilerBuild().id);
  });

  it('kit: the tabs and the accordion are islands with a module; the cards render statically with React', async () => {
    const page = await compilePage(await inputOf(fixture('kit.jsx')), loadCompilerBuild());
    expect(page.islands.length).toBeGreaterThanOrEqual(2);
    expect(page.islands.flatMap((i) => i.kit)).toEqual(expect.arrayContaining(['Tabs', 'Accordion']));
    expect(page.module).toMatchObject({ url: expect.stringMatching(/^\/islands\/d\/[0-9a-f]{16}\.js$/), bytes: expect.any(Number) });
    expect(page.module!.imports.some((u) => u === loadCompilerBuild().manifest['@mx/rt'])).toBe(true);
    expect(page.reactStatic).toEqual(expect.arrayContaining(['Card']));
    const root = dom(page.html);
    expect(root.querySelector('[role="tablist"]')).toBeTruthy();
    expect(root.querySelector('[data-hk]')).toBeTruthy();
    expect(page.html).not.toContain('<mx-slot');
  });

  it('dashboard: the data-bound embeds are islands, the plan is present, the chart has its slot', async () => {
    const page = await compilePage(await inputOf(fixture('dashboard.jsx').replaceAll('{{sales}}', 'SALES1'), 'dashboard'), loadCompilerBuild());
    expect(page.plan).not.toBeNull();
    expect(page.plan!.queries.map((q) => q.name)).toEqual(['regions', 'monthly', 'by_product']);
    expect(page.islands.flatMap((i) => i.kit)).toEqual(expect.arrayContaining(['Select', 'Number', 'Question', 'DataTable']));
    expect(page.islands.every((i) => i.readsData)).toBe(true);
    expect(dom(page.html).querySelector(`[${CHART_SLOT_ATTR}="AVkX"]`)).toBeTruthy();
  });

  it('deck: no islands, the rail and present bar rendered, the deck behaviour named', async () => {
    const page = await compilePage(await inputOf(fixture('deck.jsx'), 'deck'), loadCompilerBuild());
    expect(page.islands).toEqual([]);
    expect(page.behaviors).toEqual(['@mx/deck']);
    expect(dom(page.html).querySelector('nav.mx-rail')).toBeTruthy();
  });

  it('is deterministic: the same input compiles to the same bytes', async () => {
    const input = await inputOf(fixture('kit.jsx'));
    const [a, b] = await Promise.all([compilePage(input, loadCompilerBuild()), compilePage(input, loadCompilerBuild())]);
    expect(a.html).toBe(b.html);
    expect(a.module!.sha).toBe(b.module!.sha);
  });

  it('refuses a version that needs an unported interactive component, naming it', async () => {
    const page = await compilePage(await inputOf('<div><DeckGL id="map" /></div>'), loadCompilerBuild());
    expect(page.partial).toContain('DeckGL');
    expect(page.unported).toEqual([]);
  });
});

describe('codegen safety', () => {
  it('the generated modules have the same structure for benign and hostile author strings, and leak nothing raw', async () => {
    const verdict = await structureIndependent((doc) => compileSources({ ...doc, build: loadCompilerBuild().id }));
    expect(verdict).toEqual({ skeletonIndependent: true, islandsIndependent: true, leaked: [] });
  });
  it('drops handlers and malformed attribute names, and refuses a malformed tag name', async () => {
    const sources = await compileSources({ ...namedHazardsDocument(), build: loadCompilerBuild().id });
    expect(sources.skeleton).not.toMatch(/onclick|onmouseover/);
    await expect(compileSources({ ...malformedTagDocument(), build: loadCompilerBuild().id })).rejects.toThrow(/refused tag name/);
  });
});
