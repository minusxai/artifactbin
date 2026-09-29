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
import { compilePage, compileSources, declaredValues, generate, KIT } from '../compiler';
import { browserModuleCode, buildDocumentModules, defaultSsrImports, evaluateModule, loadSsrModule, renderSkeleton, ssrImportTable, ssrModuleCode, transformSolid, type SsrImports } from '../bundle.server';
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
import { STORY_UI_COMPONENTS } from '@/lib/story-ui/registry';

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
  it('keeps large island markup in inert page templates instead of the browser module', async () => {
    const marker = 'panel-content-' + 'A'.repeat(50_000);
    const input = await inputOf(`<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList><TabsContent value="one"><p>${marker}</p></TabsContent><TabsContent value="two"><p>Second panel</p></TabsContent></Tabs>`);
    const store = createModuleStore();
    const built = await buildDocumentModules(generate(input), { build: loadCompilerBuild(), flow: input.flow, values: declaredValues(input.flow), store });
    const browser = new TextDecoder().decode((await store.get(built.module!.sha))!);
    expect(built.html).toContain('data-mx-island-template');
    expect(built.html).toContain(marker);
    expect(browser).not.toContain(marker);
    expect(browser).not.toContain('Second panel');
    expect(brotliCompressSync(browser).byteLength).toBeLessThan(4_000);
  });
  it('keeps a multi-megabyte unopened panel out of the browser module', async () => {
    let seed = 0x4d595df4;
    const letter = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return 'abcdefghijklmnopqrstuvwxyz'[(seed >>> 0) % 26]; };
    const blocks = Array.from({ length: 180 }, (_, i) => `<p>${i}:${Array.from({ length: 18_000 }, letter).join('')}</p>`).join('');
    const input = await inputOf(`<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList><TabsContent value="one">Ready</TabsContent><TabsContent value="two">${blocks}</TabsContent></Tabs>`);
    const store = createModuleStore();
    const generated = generate(input);
    const before = await transformSolid(generated.islands, { generate: 'dom', hydratable: true }, { minify: true, moduleName: '@mx/rt' });
    const built = await buildDocumentModules(generated, { build: loadCompilerBuild(), flow: input.flow, values: declaredValues(input.flow), store });
    const bytes = (await store.get(built.module!.sha))!;
    expect(Buffer.byteLength(blocks)).toBeGreaterThan(3_000_000);
    expect(brotliCompressSync(before).byteLength).toBeGreaterThan(100_000);
    expect(dom(built.html).querySelectorAll('template[data-mx-island-template]').length).toBeGreaterThan(0);
    expect([...dom(built.html).querySelectorAll('template[data-mx-island-template]')].some((node) => (node as HTMLTemplateElement).content.textContent?.includes(blocks.slice(3, 120)))).toBe(true);
    expect(brotliCompressSync(bytes).byteLength).toBeLessThan(4_000);
  });
  it('escapes hostile template closers in the served inert bank', async () => {
    const input = await inputOf('<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList><TabsContent value="one">safe</TabsContent><TabsContent value="two"><p>&lt;/template&gt;&lt;script&gt;alert(1)&lt;/script&gt;</p></TabsContent></Tabs>');
    const store = createModuleStore();
    const built = await buildDocumentModules(generate(input), { build: loadCompilerBuild(), flow: input.flow, values: declaredValues(input.flow), store });
    expect(built.html).toContain('data-mx-island-template');
    const root = dom(built.html);
    const banks = [...root.querySelectorAll('template[data-mx-island-template]')] as HTMLTemplateElement[];
    const literals = JSON.parse(root.querySelector('script[data-mx-island-literals]')!.textContent!) as string[];
    expect([...banks.map((bank) => bank.content.textContent ?? ''), ...literals].join('')).toContain('alert(1)');
    expect(built.html).not.toContain('</template><script>alert(1)</script>');
    expect(new TextDecoder().decode((await store.get(built.module!.sha))!)).not.toContain('alert(1)');
  });
  it('moves only large used hoisted props into page data', async () => {
    const note = 'literal-prop-' + 'x'.repeat(2_000);
    const generated = generate(await inputOf(`<Question id="q" viz={{kind:"table",note:${JSON.stringify(note)}}} />`));
    expect(generated.moduleData).toContain(JSON.stringify({ kind: 'table', note }));
    expect(generated.browserIslands).not.toContain(note);
    expect(generated.islands).toContain(note);
  });
  it('measures the synthetic 10 MB table module before and after', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ label: `row ${i}: ${'x'.repeat(100_000)}` }));
    const input = await inputOf(`<Helmet><Value name="rows" type="table" value={${JSON.stringify(rows)}} /></Helmet><For each={$rows}><p>$_row.label</p></For>`);
    const generated = generate(input);
    const build = loadCompilerBuild();
    const before = await transformSolid(`${generated.islands}\nconst FLOW=JSON.parse(${JSON.stringify(JSON.stringify(input.flow))});`, { generate: 'dom', hydratable: true }, { minify: true, moduleName: '@mx/rt' });
    const flowIndex = generated.moduleData.length;
    const islands = generated.moduleData.length ? generated.browserIslands : `const $moduleData = JSON.parse(document.getElementById("mx-story-data").textContent).moduleData;\n${generated.browserIslands}`;
    const after = await browserModuleCode(islands, build, input.flow, flowIndex);
    expect(Buffer.byteLength(JSON.stringify(rows))).toBeGreaterThan(10_000_000);
    expect(Buffer.byteLength(before)).toBeGreaterThan(10_000_000);
    expect(Buffer.byteLength(after.code)).toBeLessThan(4_000);
  });
  it('keeps a large literal table out of the browser module and carries it in the page', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ label: `row ${i}: ${'x'.repeat(180)}` }));
    const source = `<Helmet><Value name="rows" type="table" value={${JSON.stringify(rows)}} /></Helmet><For each={$rows}><p>$_row.label</p></For>`;
    const page = await compilePage(await inputOf(source), loadCompilerBuild());
    expect(page.module).not.toBeNull();
    expect(page.module!.bytes).toBeLessThan(4_000);
    expect(page.html).toContain(rows[0]!.label);
    expect(page.html).toMatch(/<script type="application\/json" data-mx-module-data>[\s\S]*<\/script>$/);
  });
  it('compiles a native Value input as a live binding', async () => {
    const source = '<Helmet><Value name="region" type="string" default="west" /></Helmet><input aria-label="Region" value="$region" />';
    const generated = generate(await inputOf(source));
    expect(generated.islands).toContain('<BoundNative tag={"input"} bind={$d0}');
    expect(generated.islands).toContain('JSON.parse("{\\\"value\\\":\\\"region\\\"}")');
    expect(generated.islandRefs.flatMap((island) => island.kit)).toContain('BoundNative');
  });

  it('keeps a bound image live and sends its source template to the image island', async () => {
    const source = '<Helmet><Value name="pick" type="string" default="https://example.test/a.png" /></Helmet><img src="$pick" alt="the pick" />';
    const generated = generate(await inputOf(source));
    expect(generated.islands).toContain('BoundImage');
    expect(generated.islands).toContain('template={"$pick"}');
    expect(generated.skeleton).not.toContain('src="$pick"');
  });

  it('routes row image attributes through the image helper after row substitution', async () => {
    const source = '<Helmet><Value name="covers" type="table" value={[{"id":1,"cover_ref":"ref:Abc123"}]} /></Helmet><For each={$covers}><img src="$_row.cover_ref" alt="cover" /></For>';
    const generated = generate(await inputOf(source));
    expect(generated.islands).toContain('BoundImage template={"$_row.cover_ref"}');
    expect(generated.islandRefs.flatMap((island) => island.kit)).not.toContain('rowImageAttrs');
  });
  it('stores the legacy outline decision and heading paths with the version', async () => {
    const source = '<article><h2>One &amp; all</h2><h3>Part</h3><h2>Two</h2><h2>Three</h2></article>';
    const page = await compilePage(await inputOf(source, 'plan'), loadCompilerBuild());
    expect(page.outline).toEqual([
      { level: 2, title: 'One & all', path: '0.0' },
      { level: 3, title: 'Part', path: '0.1' },
      { level: 2, title: 'Two', path: '0.2' },
      { level: 2, title: 'Three', path: '0.3' },
    ]);
    expect(page.outlinePlan).toBe(true);
    expect((await compilePage(await inputOf(source, 'dashboard'), loadCompilerBuild())).outline).toEqual([]);
    expect((await compilePage({ ...(await inputOf(source, 'plan')), chrome: false }, loadCompilerBuild())).outline).toEqual([]);
  });
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
    expect(dom(page.html).querySelector('#AVkX')?.hasAttribute(CHART_SLOT_ATTR)).toBe(false);
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

  it('ports every registered component: none is served with its behaviour missing (partial) or refused (unported)', () => {
    // w3-behaviour: the managed <Iframe> and the <DeckGL> map were the last partial ones; each is an island now.
    for (const tag of Object.keys(STORY_UI_COMPONENTS)) {
      const { nodes } = parseJsx(`<div><${tag} id="x" /></div>`) as { nodes: JsxNode[] };
      let generated: ReturnType<typeof generate>;
      // A part that only renders inside its parent (AvatarImage outside Avatar) is not a component a page holds alone.
      try { generated = generate({ nodes, colorMode: 'light', template: null, chrome: true, refData: {}, flow: null }); } catch (error) { if (/must be used within/.test(String(error))) continue; throw error; }
      expect({ tag, partial: generated.partial, unported: generated.unported }).toEqual({ tag, partial: [], unported: [] });
    }
  });

  it('compiles <Iframe> and <DeckGL> as islands in the embed family, served as today\'s boxes', async () => {
    const source = '<div><Iframe title="Gallery" height={120} id="f" className="my-4"><p>Hello</p><script>{`document.body.dataset.ok = "1"`}</script></Iframe><DeckGL id="map" className="rounded" title="Countries" height="320px" basemap="none" layers={[{"@@type":"ScatterplotLayer","getPosition":"@@=[lng, lat]"}]} /></div>';
    const input = await inputOf(source);
    // Their own family (lib/islands/contract KIT_FAMILIES 'embed'): a page with a table never downloads the frame's island code.
    const { islands } = generate(input);
    expect(islands).toContain('import { DeckGL, Iframe } from "@mx/kit/embed";');
    expect(islands).not.toContain('@mx/kit/data');
    // The asset door is the page's (IslandPageData.managedAssets), never a compile-time prop.
    expect(islands).not.toContain('assetsOrigin');
    const page = await compilePage(input, loadCompilerBuild());
    expect(page.partial).toEqual([]);
    expect(page.islands.map((i) => i.kit)).toEqual([['Iframe'], ['DeckGL']]);
    const html = dom(page.html);
    const frame = html.querySelector('#f')!;
    // Attributes compared as sets (shapeOf keeps data-mx-ast out; it is asserted on its own).
    expect(frame.getAttribute('data-mx-ast')).toBe('0.0');
    expect(shapeOf(frame.outerHTML)).toEqual(shapeOf('<div id="f" class="my-4" data-mx-managed-frame="" aria-label="Gallery" style="height:120px;width:100%"><div style="height:100%"></div></div>'));
    // Today's runtime adapter: the identity on the outer box, the author's class on the map's own box, the stand-in inside.
    const map = html.querySelector('#map')!;
    expect(map.getAttribute('data-mx-ast')).toBe('0.1');
    expect(shapeOf(map.outerHTML)).toEqual(shapeOf('<div id="map"><div class="rounded"><div class="w-full rounded-md bg-muted" style="height:320px" aria-busy="true" aria-label="Countries"></div></div></div>'));
    // The frame's author content reaches the island only as data: compiled at publish (lib/story/managed-iframe), never as markup.
    expect(dom(page.html).querySelector('#f')?.textContent).not.toContain('Hello');
  });

  it('compiles a DataTable column\'s content per row, and a control with run there as today\'s editing cell', async () => {
    const source = '<Helmet><Value name="t" type="table" value={[{"id":1,"s":"a","n":2,"w":""}]} /><Mutation name="set_s">{`update t set s=$_value where id=$_row.id`}</Mutation>'
      + '<Mutation name="set_n">{`update t set n=$_value where id=$_row.id`}</Mutation></Helmet>'
      + '<DataTable data="$t" rowKey="id" id="tbl"><Column col="id" /> <Column col="w">\n  </Column><Column col="note"><b id="n">{$_row.s}</b></Column>'
      + '<Column col="s"><Select label="S {$_row.id}" value="$_row.s" options={["a","b"]} run="$set_s" className="w-24" /></Column>'
      + '<Column col="n"><input type="number" value="$_row.n" run="$set_n" /></Column></DataTable>';
    const { islands } = generate(await inputOf(source.replace('"w":""}', '"w":"","note":""}')));
    // Its own family: a page without column content never loads the cells.
    expect(islands).toContain('import { CellControl, cellAttrs } from "@mx/kit/cells";');
    expect(islands).toContain('import { DataTable } from "@mx/kit/data";');
    // One entry per <Column>, a hole where the content draws nothing (whitespace), a function per row otherwise.
    expect(islands).toContain('cells={[undefined, undefined, (row');
    expect(islands).toMatch(/<b \{\.\.\.cellAttrs\(\$d\d+, row\d+_\d+, cell\d+_\d+\)\}>\{rt\.text\(/);
    // Today's classes, merged at compile time (tailwind-merge: the cell's flex replaces the shell's inline-flex, the author's w-24 the cell's w-full).
    expect(islands).toContain('<CellControl tag={"Select"} run={"set_s"} field={"s"}');
    expect(islands).toContain('cls={"mx-control relative flex-col gap-1.5 align-top flex min-w-0 w-24"}');
    expect(islands).toContain('<CellControl tag={"input"} run={"set_n"} field={"n"}');
    expect(islands).toContain('cls={"w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none transition-colors hover:border-border focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50 h-8 text-right tabular-nums"}');
    expect(islands).toMatch(/templates=\{\$d\d+\}/);
  });

  it('an <Iframe> whose content is refused renders nothing, as the interpreter does', async () => {
    const page = await compilePage(await inputOf('<div><Iframe title="x" height={120}><iframe src="https://x.test" /></Iframe><p id="after">after</p></div>'), loadCompilerBuild());
    expect(page.islands).toEqual([]);
    expect(dom(page.html).querySelector('[data-mx-managed-frame]')).toBeNull();
    expect(dom(page.html).querySelector('#after')).toBeTruthy();
  });
});

describe('island keys (the live morph keeps an island a new version carries again)', () => {
  const keysOf = async (source: string): Promise<Record<string, string>> => {
    const generated = generate(await inputOf(source));
    const keys: Record<string, string> = {};
    for (const [, rid, key] of generated.islands.matchAll(/\[("s\d+-"), I\d+, ("[0-9a-f]{16}")\]/g)) keys[JSON.parse(rid!)] = JSON.parse(key!);
    return keys;
  };
  const helmet = '<Helmet><Value name="region" type="string" default="West" /><Value name="other" type="string" default="x" /></Helmet>';

  it('names the same island by the same key when an island before it shifts its render id and its constants', async () => {
    const before = await keysOf(`${helmet}<div id="w"><section id="s1"><p id="p1">static</p></section><section id="s2"><p id="b" title="{$other}">{$region}</p></section></div>`);
    const after = await keysOf(`${helmet}<div id="w"><section id="s1"><p id="p1">static</p><p id="n" title="{$region}">{$other}</p></section><section id="s2"><p id="b" title="{$other}">{$region}</p></section></div>`);
    expect(Object.keys(before)).toEqual(['s0-']);
    expect(Object.keys(after)).toEqual(['s0-', 's1-']);
    expect(after['s1-'], 'island b, now second: same definition, same key').toBe(before['s0-']);
    expect(after['s0-']).not.toBe(before['s0-']);
  });

  it('gives a changed island another key', async () => {
    const one = await keysOf(`${helmet}<div id="w"><p id="b">{$region}</p></div>`);
    const two = await keysOf(`${helmet}<div id="w"><p id="b">{$other}</p></div>`);
    expect(one['s0-']).toMatch(/^[0-9a-f]{16}$/);
    expect(two['s0-']).not.toBe(one['s0-']);
  });
});

describe('unit parity with the real kit', () => {
  it('kit: the whole compiled column, islands included, is today\'s render', async () => {
    const source = fixture('kit.jsx');
    const diffs = columnParity((await compilePage(await inputOf(source), loadCompilerBuild())).html, source);
    // Radix's Presence writes `animation-duration:0s` on closed accordion content at its FIRST mount only
    // (so a closed panel does not animate in); the Solid kit renders the steady state. Anything else is a diff.
    expect(diffs.filter((d) => !d.endsWith('@style: "animation-duration:0s" vs undefined'))).toEqual([]);
  });
});

describe('the kit table', () => {
  it('names, for every ported component, a family of the shared build that exports it', async () => {
    const families = [...new Set(Object.values(KIT).map((m) => m.mod))].map((mod) => `@mx/kit/${mod}`);
    const imports = await defaultSsrImports(families.map((spec, i) => `import * as k${i} from ${JSON.stringify(spec)};`).join('\n'));
    const missing = Object.entries(KIT).filter(([tag, meta]) => typeof imports(`@mx/kit/${meta.mod}`)[tag] !== 'function').map(([tag, meta]) => `${tag} (@mx/kit/${meta.mod})`);
    expect(missing).toEqual([]);
  });
});

describe('a version with an author script', () => {
  const SCRIPT = 'mx.set({ n: 1 })';
  it('carries the script as data and boots even with no island: a module with ISLANDS = [], no SSR module, the skeleton as its story', async () => {
    const build = loadCompilerBuild();
    const input = { ...(await inputOf(fixture('prose.jsx'))), authorScript: SCRIPT };
    const page = await compilePage(input, build);
    expect(page.authorScript).toBe(SCRIPT);
    expect(page.islands).toEqual([]);
    expect(page.module, 'the page must start its store and the author host').not.toBeNull();
    expect(page.module!.imports).toEqual(expect.arrayContaining([build.manifest['@mx/boot']]));
    expect(page.ssr, 'no island renders data: the stored html is the story').toBeNull();
    expect(page.html).toBe((await compilePage(await inputOf(fixture('prose.jsx')), build)).html);
    const code = new TextDecoder().decode((await createModuleStore().get(page.module!.sha))!);
    expect(code, 'the author code is never part of a module served under /islands/d/').not.toContain('mx.set');
  });

  it('keeps it beside the islands of a version that has them, and none when it has none', async () => {
    const build = loadCompilerBuild();
    const kit = await compilePage({ ...(await inputOf(fixture('kit.jsx'))), authorScript: SCRIPT }, build);
    expect(kit.authorScript).toBe(SCRIPT);
    expect(kit.module).not.toBeNull();
    const plain = await compilePage(await inputOf(fixture('prose.jsx')), build);
    expect(plain.authorScript).toBeNull();
    expect(plain.module).toBeNull();
  });
});

describe('the stored plan', () => {
  const source = '<Helmet><Import name="sales" src="ref:SALES1" /><Query name="total">{`select sum(revenue) as r from sales.rows`}</Query></Helmet><p id="p">Totals</p>';
  it('is planned with the anonymous reader\'s access the caller decided, and conservatively without it', async () => {
    const input = await inputOf(source);
    const admitted = await compilePage({ ...input, access: { datasets: { SALES1: { anonymousRead: true } } } }, loadCompilerBuild());
    expect(admitted.plan!.queries.map((q) => [q.name, q.scope])).toEqual([['total', 'shared']]);
    expect(admitted.plan!.datasets).toEqual(['SALES1']);
    const unknown = await compilePage(input, loadCompilerBuild());
    expect(unknown.plan!.queries.map((q) => [q.name, q.scope])).toEqual([['total', 'viewer']]);
  });
});

describe('no refusal', () => {
  // w3-compiler-coverage: a registered component with no Solid port inside a row compiles as a shell (today's React
  // render with the row's attributes filled per row); nothing a stored document holds is refused any more.
  it('a registered component with no Solid port inside a row compiles whole, its markup today\'s per row', async () => {
    const page = await compilePage(await inputOf('<Helmet><Value name="rows" type="table" value={[{"k":"a"},{"k":"b"}]} /></Helmet><ul id="l"><For each={$rows} keyBy="k"><li id="i"><Separator id="s" /></li></For></ul>'), loadCompilerBuild());
    expect(page.unported).toEqual([]);
    expect(page.module).not.toBeNull();
    expect(page.ssr).not.toBeNull();
    expect(page.reactStatic).toContain('Separator');
    expect([...dom(page.html).querySelectorAll('li [data-slot="separator"]')]).toHaveLength(2);
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
  it('kit: the served tabs are Radix\'s server render (tablist and tabs -1, the active panel\'s mount style as React writes it)', async () => {
    const source = fixture('kit.jsx');
    const page = await compilePage(await inputOf(source), loadCompilerBuild());
    const root = dom(page.html);
    expect(root.querySelector('[role="tablist"]')?.getAttribute('tabindex')).toBe('-1');
    expect([...root.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '-1']);
    expect([...root.querySelectorAll('[role="tabpanel"]')].map((p) => p.getAttribute('style'))).toEqual(['animation-duration:0s', null]);
    const react = new JSDOM(`<div>${reactRender(source)}</div>`).window.document;
    expect([...react.querySelectorAll('[role="tabpanel"]')].map((p) => p.getAttribute('style'))).toEqual(['animation-duration:0s', null]);
    expect(react.querySelector('[role="tablist"]')?.getAttribute('tabindex')).toBe('-1');
  });
  it('mermaid in a grid tile: the served figure is today\'s tile render (the tile owns the size)', async () => {
    const source = '<Grid cols={12} id="g"><GridItem x={0} y={0} w={6} h={4} id="gi"><Mermaid code="flowchart LR\n  A --> B" title="Flow" id="m" /></GridItem></Grid>';
    const page = await compilePage(await inputOf(source), loadCompilerBuild());
    expect(dom(page.html).querySelector('#m')?.getAttribute('class')).toContain('flex h-full w-full flex-col');
    expect(columnParity(page.html, source)).toEqual([]);
  });
  it('a kit component served around an island writes its class as React does (no trailing space, no empty class)', async () => {
    const source = '<Helmet><Value name="who" type="string" default="Ada" /></Helmet><Card id="c"><CardContent id="cc" className="gap-4"><p id="p">{$who}</p></CardContent></Card>';
    const page = await compilePage(await inputOf(source), loadCompilerBuild());
    const react = new JSDOM(`<div>${reactRender(source)}</div>`).window.document;
    for (const id of ['c', 'cc']) expect(dom(page.html).querySelector(`#${id}`)?.getAttribute('class'), id).toBe(react.querySelector(`#${id}`)?.getAttribute('class'));
    expect(page.html).not.toMatch(/ class="[^"]* "/);
  });
  it('serves bound controls as today\'s live reader serves them: no binding stamp, no read-only flag, a textarea\'s value as its content', async () => {
    const page = await compilePage(await inputOf('<Helmet><Value name="note" type="string" default="Two &amp; more" /><Value name="n" type="number" default={3} /></Helmet><div id="w"><Textarea label="Note" value="$note" id="ta" /><Input label="N" value="$n" id="in" /><Slider label="S" value="$n" min={0} max={10} id="sl" /></div>'), loadCompilerBuild());
    const root = dom(page.html);
    expect(page.html).not.toContain('data-mx-bound');
    expect(root.querySelectorAll('[readonly]')).toHaveLength(0);
    const textarea = root.querySelector('textarea')!;
    expect(textarea.hasAttribute('value')).toBe(false);
    expect(textarea.textContent).toBe('Two & more');
    expect(root.querySelector('#in input')?.getAttribute('value')).toBe('3');
  });
  it('a guest\'s person components are served with the fallback\'s class, merged with the author\'s as today', async () => {
    const page = await compilePage(await inputOf('<div id="w"><User userId="$_me.id" fallback="a guest" className="text-red-500" id="u" /><UserImage userId="$_me.id" size="lg" fallback="no picture" id="i" /></div>'), loadCompilerBuild());
    const root = dom(page.html);
    expect(root.querySelector('#u')?.getAttribute('class')).toBe('text-red-500');
    expect(root.querySelector('#u')?.textContent).toBe('a guest');
    expect(root.querySelector('#i')?.getAttribute('class')).toBe('text-muted-foreground');
  });
  it('writing a spread class as React does never moves hydration keys: the children still render after their element', async () => {
    const source = `function Box(p) { return <span data-slot="box" {...p} />; }
function Leaf() { return <i>leaf</i>; }
export function render(withClass) { return renderToString(() => withClass ? <Box class="x y"><Leaf /><Leaf /></Box> : <Box><Leaf /><Leaf /></Box>, { renderId: 's0-' }); }
import { renderToString } from 'solid-js/web';`;
    const mod = await evaluateModule(await transformSolid(source, { generate: 'ssr', hydratable: true }), ssrImportTable(), 'test/keys.js') as { render: (withClass: boolean) => string };
    const keys = (html: string) => [...html.matchAll(/data-hk="([^"]+)"/g)].map((m) => m[1]);
    expect(keys(mod.render(true))).toEqual(keys(mod.render(false)));
    expect(mod.render(true)).toContain('class="x y"');
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

    // The SSR module holds the whole page: it is stored where no route serves it, never beside the browser module.
    expect(built.ssr!.url).toBe(`islands-ssr/${built.ssr!.sha}`);
    expect(await store.get(built.ssr!.sha)).toBeNull();
    const ssr = await loadSsrModule(built.ssr!, undefined, imports);
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
