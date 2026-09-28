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
import { brotliCompressSync } from 'node:zlib';
import { compilePage, compileSources, declaredValues, generate } from '../compiler';
import { browserModuleCode, buildDocumentModules, evaluateModule, loadSsrModule, renderSkeleton, ssrImportTable, ssrModuleCode, transformSolid, type SsrImports } from '../bundle.server';
import { createModuleStore } from '../modules.server';
import { shapeOf, diffShapes, reactRender } from '@/lib/islands/__tests__/kit-parity';
import { loadCompilerBuild } from '../build.server';
import { malformedTagDocument, namedHazardsDocument, structureIndependent } from '../codegen-safety';
import { CHART_SLOT_ATTR, type CompileInput } from '../contract';
import { prepareStoryParts } from '@/lib/story/prepare-runtime.server';
import { compileDataflow, prepareCompile, type ImportSource } from '@/lib/story/compile-dataflow';
import { dataflowOf, splitHelmet } from '@/lib/story/helmet';
import type { Dataflow } from '@/lib/story/dataflow';
import type { JsxNode } from '@/lib/jsx';
import { parseJsx } from '@/lib/jsx';

const FIXTURES = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

// The dashboard fixture's import (`ref:{{sales}}` → SALES1), with sales.csv's columns: compileDataflow dry-runs the SQL against the schema.
const SOURCES: Record<string, ImportSource> = {
  SALES1: { kind: 'dataset', tables: [{ name: 'rows', columns: [{ name: 'month', type: 'date' }, { name: 'region', type: 'string' }, { name: 'product', type: 'string' }, { name: 'revenue', type: 'number' }, { name: 'units', type: 'number' }] }] },
};
async function compiledFlow(declared: Dataflow, body: JsxNode[]) {
  const result = compileDataflow(declared, await prepareCompile(declared, async (ref) => SOURCES[ref] ?? null), body);
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

describe('refusal', () => {
  it('a registered component with no Solid port inside a row refuses the compile, named, with nothing built', async () => {
    const page = await compilePage(await inputOf('<Helmet><Value name="rows" type="table" value={[{"k":"a"}]} /></Helmet><ul id="l"><For each={$rows} keyBy="k"><li id="i"><Separator id="s" /></li></For></ul>'), loadCompilerBuild());
    expect(page.unported).toEqual(['Separator']);
    expect(page.module).toBeNull();
    expect(page.ssr).toBeNull();
  });
});

describe('names', () => {
  it('a hyphenated api prop is an attribute name, not a refusal', async () => {
    const { islands } = await compileSources(await inputOf('<Helmet><Value name="q" type="string" /></Helmet><div id="w"><Input aria-label="Search" value="$q" id="i" /></div>'));
    expect(islands).toContain('aria-label={"Search"}');
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

/* ── Added by w2-compiler: unit parity, the island path, and the generated modules' safety ── */

/** The compiled story column's children against today's render of the same source (kit-parity: generated ids normalised). */
const columnParity = (html: string, source: string, drop: string[] = []): string[] => {
  const column = dom(html).querySelector('.mx-doc')!;
  const react = new JSDOM(`<div>${reactRender(source)}</div>`).window.document.body.firstElementChild!;
  for (const root of [column, react]) for (const id of drop) root.querySelector(`#${id}`)?.remove();
  return diffShapes(shapeOf(react), shapeOf(column));
};

describe('unit parity with today\'s render', () => {
  it('prose: the compiled column is today\'s render', async () => {
    const source = fixture('prose.jsx');
    expect(columnParity((await compilePage(await inputOf(source), loadCompilerBuild())).html, source)).toEqual([]);
  });
  it('deck: the compiled column is today\'s render; the rail and present bar sit around it', async () => {
    const source = fixture('deck.jsx');
    const page = await compilePage(await inputOf(source, 'deck'), loadCompilerBuild());
    expect(columnParity(page.html, source)).toEqual([]);
    expect(dom(page.html).querySelectorAll('nav.mx-rail button.mx-rail-row')).toHaveLength(8);
    // What the deck behaviour (@mx/deck startDeck) binds to.
    expect(dom(page.html).querySelectorAll('.mx-doc [data-mx-slide]')).toHaveLength(8);
    expect([...dom(page.html).querySelectorAll('.mx-present button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Previous slide', 'Next slide', 'Present']);
    expect(dom(page.html).querySelector('.mx-present-count')?.textContent).toBe('1 / 8');
  });
});

/**
 * A stand-in for the shared build's server half (not built yet: see the report's contract request)
 * and for the kit families' Solid ports (w2-kit-*): just enough Solid to render the kit fixture's
 * islands on the server, so the island path — slots, hydration keys, both stored modules, `render`
 * from the store — is proven independently of what the kit renders.
 */
const STAND_IN = {
  '@mx/rt': `import { createContext } from 'solid-js';
const Island = createContext(null);
export function IslandProvider(props) { return <Island.Provider value={props.value}>{props.children}</Island.Provider>; }
export const withIsland = (Component, context) => <IslandProvider value={context}><Component /></IslandProvider>;
export function createIslandRuntime(data, createStore) { return { context: { values: () => data.dataflow ? data.dataflow.values : {} }, store: createStore, dispose() {} }; }
export const createDataflowStore = null;`,
  '@mx/kit/tabs': `export function Tabs(props) { return <div data-slot="tabs" class={props.class} id={props.id} data-mx-ast={props['data-mx-ast']} data-default={props.defaultValue}>{props.children}</div>; }
export function TabsList(props) { return <div role="tablist" class={props.class} id={props.id}>{props.children}</div>; }
export function TabsTrigger(props) { return <button type="button" role="tab" class={props.class} id={props.id}>{props.children}</button>; }
export function TabsContent(props) { return <div role="tabpanel" class={props.class} id={props.id}>{props.children}</div>; }`,
  '@mx/kit/accordion': `export function Accordion(props) { return <div data-slot="accordion" class={props.class} id={props.id}>{props.children}</div>; }
export function AccordionItem(props) { return <div class={props.class} id={props.id}>{props.children}</div>; }
export function AccordionTrigger(props) { return <h3><button type="button" id={props.id}>{props.children}</button></h3>; }
export function AccordionContent(props) { return <div role="region" id={props.id}>{props.children}</div>; }`,
};
async function standInImports(): Promise<SsrImports> {
  const namespaces: Record<string, Record<string, unknown>> = {};
  for (const [spec, source] of Object.entries(STAND_IN)) namespaces[spec] = await evaluateModule(await transformSolid(source, { generate: 'ssr', hydratable: true }), ssrImportTable(), `stand-in/${spec}.js`);
  return ssrImportTable(namespaces);
}

describe('the island path, over a stand-in server half', () => {
  it('kit: islands render in their slots with hydration keys, both modules are stored, and the stored SSR module renders the same story', async () => {
    const build = loadCompilerBuild();
    const input = await inputOf(fixture('kit.jsx'));
    const generated = generate(input);
    const imports = await standInImports();
    const store = createModuleStore();
    const built = await buildDocumentModules(generated, { build, flow: input.flow, values: declaredValues(input.flow), imports, store });
    const root = dom(built.html);
    expect(built.html).not.toContain('<mx-slot');
    expect(root.querySelector('[role="tablist"]')).toBeTruthy();
    expect(root.querySelector('[data-hk^="s0-"]')?.id).toBe('KpKx');
    expect(root.querySelector('[data-hk^="s1-"]')?.id).toBe('ax0B');
    // Static parts carry no hydration keys: only the islands hydrate.
    expect(root.querySelector('#AlhE')?.hasAttribute('data-hk')).toBe(false);
    expect(columnParity(built.html, fixture('kit.jsx'), ['KpKx', 'ax0B'])).toEqual([]);

    const module = built.module!;
    expect(module.url).toMatch(/^\/islands\/d\/[0-9a-f]{16}\.js$/);
    expect(module.imports).toEqual(expect.arrayContaining([build.manifest['@mx/rt'], build.manifest['@mx/boot'], build.manifest['@mx/kit/tabs'], build.manifest['@mx/kit/accordion']]));
    const bytes = (await store.get(module.sha))!;
    const text = new TextDecoder().decode(bytes);
    expect(text).not.toMatch(/from\s*["'](@mx\/|solid-js)/);
    // Solid's DOM helpers come through the runtime's one import surface: every import is a shared-build URL of an @mx/* entry.
    const entryUrls = new Set(Object.entries(build.manifest).filter(([spec]) => spec.startsWith('@mx/')).map(([, url]) => url));
    for (const m of text.matchAll(/from\s*"([^"]+)"/g)) expect(entryUrls, m[1]).toContain(m[1]);
    const br = brotliCompressSync(bytes).byteLength;
    // Target 2's per-document share (the brief: ≤ 5 KB br for the kit fixture); measured 2283 B raw / 614 B br.
    expect(br, `kit per-document module: ${bytes.byteLength} B raw, ${br} B br`).toBeLessThanOrEqual(5 * 1024);

    const ssr = await loadSsrModule(built.ssr!, store, imports);
    expect(ssr.render({ values: {}, results: null, mermaidImages: {}, drawings: {} })).toBe(built.html);
    const again = await buildDocumentModules(generate(input), { build, flow: input.flow, values: declaredValues(input.flow), imports, store });
    expect(again.module!.sha).toBe(module.sha);
    expect(again.ssr!.sha).toBe(built.ssr!.sha);
  });

  it('dashboard: the chart slot names the question, and every island reads data', async () => {
    const generated = generate(await inputOf(fixture('dashboard.jsx').replaceAll('{{sales}}', 'SALES1'), 'dashboard'));
    expect(generated.islands).toContain(`${CHART_SLOT_ATTR}={"AVkX"}`);
    expect(generated.islandRefs.every((i) => i.readsData)).toBe(true);
    expect(generated.islandRefs.flatMap((i) => i.kit)).toEqual(expect.arrayContaining(['Select', 'Number', 'Question', 'DataTable']));
  });
});

describe('the generated modules, compiled', () => {
  it('the browser and SSR modules are structure independent for benign and hostile author strings too', async () => {
    const build = loadCompilerBuild();
    const verdict = await structureIndependent(async (doc) => {
      const generated = generate(doc);
      const skeleton = await renderSkeleton(generated.skeleton);
      return { skeleton: await ssrModuleCode(generated.islands, skeleton, doc.flow), islands: (await browserModuleCode(generated.islands, build)).code };
    });
    expect(verdict).toEqual({ skeletonIndependent: true, islandsIndependent: true, leaked: [] });
  });
});
