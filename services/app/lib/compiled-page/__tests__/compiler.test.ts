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
import { performance } from 'node:perf_hooks';
import { compilePage, compileSources, declaredValues, generate, KIT } from '../compiler';
import { browserModuleCode, buildDocumentModules, defaultSsrImports, evaluateModule, loadSsrModule, ssrImportTable, ssrModuleCode, transformSolid } from '../bundle.server';
import { createModuleStore } from '../modules.server';
import { bindModuleCode } from '../runtime-binding';
import { shapeOf, diffShapes, reactRender } from '@/lib/islands/__tests__/kit-parity';
import { loadCompilerBuild } from '../build.server';
import { malformedTagDocument, namedHazardsDocument, structureIndependent } from '../codegen-safety';
import { CHART_SLOT_ATTR, type CompileInput } from '../contract';
import { prepareStoryParts } from '@/lib/story/prepared/prepare-runtime.server';
import { compileDataflow, prepareCompile, type ImportSource } from '@/lib/story/data/compile-dataflow';
import { dataflowOf, splitHelmet } from '@/lib/story/document/helmet';
import type { Dataflow } from '@/lib/story/data/dataflow';
import type { JsxNode } from '@/lib/jsx';
import { parseJsx } from '@/lib/jsx';
import { STORY_UI_COMPONENT_NAME_LIST } from '@/lib/story-ui/component-names';

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
  it('compiles an 11 MB static run inside an island within a bounded time', async () => {
    const text = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(300);
    const rows = Array.from({ length: 1_100 }, (_, i) => `<p id="row-${i}">Static row ${i} ${text}</p>`).join('');
    const input = await inputOf(`<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger></TabsList><TabsContent value="one">${rows}</TabsContent></Tabs>`);
    const start = performance.now();
    const generated = generate(input);
    const built = await buildDocumentModules(generated, { build: loadCompilerBuild(), flow: null, values: {} });
    expect(built.html).toContain('Static row 1099');
    expect(performance.now() - start).toBeLessThan(8_000);
  }, 30_000);
  it('restores long hostile static text in the served document and a reloaded SSR module', async () => {
    const hostile = `begin </script><script>alert(1)</script> & {braces} backslash \\ backtick \` interpolation \${value} ${'x'.repeat(2_000)} end`;
    const input = await inputOf(`<Tabs defaultValue="one"><TabsContent value="one"><p>${hostile.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')}</p></TabsContent></Tabs>`);
    const store = createModuleStore();
    const built = await buildDocumentModules(generate(input), { build: loadCompilerBuild(), flow: null, values: {}, store });
    // Static content is server owned: the browser module never carries it.
    expect(new TextDecoder().decode((await store.get(built.module!.sha))!)).not.toContain('alert(1)');
    expect(dom(built.html).textContent).toContain(hostile);
    const reloaded = await loadSsrModule(built.ssr!);
    const html = reloaded.render({ values: {}, results: null, mermaidImages: {}, drawings: {} });
    expect(dom(html).textContent).toContain(hostile);
    expect(html).not.toContain('</script><script>alert(1)</script>');
  });
  it('keeps notification definitions out of externalized reader flow data', async () => {
    const source = `<Helmet><Import name="sales" src="ref:SALES1" /><Value name="padding" type="string" default="${'x'.repeat(2000)}" /><Mutation name="change">{\`UPDATE sales.rows SET revenue = revenue + 1\`}</Mutation><Notify name="server_notice" on="change">{\`SELECT null AS "to", 'private-notification-sql' AS message\`}</Notify></Helmet><p>Public content</p>`;
    const input = await inputOf(source);
    const store = createModuleStore();
    const built = await buildDocumentModules(generate(input), { build: loadCompilerBuild(), flow: input.flow, values: declaredValues(input.flow), store, boot: true });
    expect(built.html).toContain('data-mx-module-data');
    const readerFlow = JSON.parse(dom(built.html).querySelector('[data-mx-module-data]')!.textContent!).moduleData.at(-1);
    expect(readerFlow.notifications).toBeUndefined();
    expect(readerFlow.mutations[0].notifies).toBe(true);
    const browser = new TextDecoder().decode((await store.get(built.module!.sha))!);
    for (const output of [built.html, browser]) {
      expect(output).not.toContain('server_notice');
      expect(output).not.toContain('private-notification-sql');
    }
  });

  it('keeps large island markup in the rendered story and a lazy resource, not the browser module', async () => {
    const marker = 'panel-content-' + 'A'.repeat(50_000);
    const input = await inputOf(`<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList><TabsContent value="one"><p>${marker}</p></TabsContent><TabsContent value="two"><p>Second panel</p></TabsContent></Tabs>`);
    const store = createModuleStore();
    const built = await buildDocumentModules(generate(input), { build: loadCompilerBuild(), flow: input.flow, values: declaredValues(input.flow), store });
    const browser = new TextDecoder().decode((await store.get(built.module!.sha))!);
    expect(built.html).not.toContain('data-mx-island-template');
    expect(built.html).toContain(marker);
    expect(built.html.split(marker)).toHaveLength(2);
    expect(Buffer.byteLength(built.html)).toBeLessThan(Buffer.byteLength(marker) + 20_000);
    expect(browser).not.toContain(marker);
    expect(browser).not.toContain('Second panel');
    expect(brotliCompressSync(browser).byteLength).toBeLessThan(4_000);
  });
  it('serves a multi-megabyte unopened panel once and keeps it out of browser JavaScript', async () => {
    let seed = 0x4d595df4;
    const letter = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return 'abcdefghijklmnopqrstuvwxyz'[(seed >>> 0) % 26]; };
    const blocks = Array.from({ length: 180 }, (_, i) => `<p>${i}:${Array.from({ length: 18_000 }, letter).join('')}</p>`).join('');
    const input = await inputOf(`<Helmet><Value name="selection" type="string" default="one" /></Helmet><Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList><TabsContent value="one">Ready</TabsContent><TabsContent value="two">${blocks}</TabsContent></Tabs>`);
    const store = createModuleStore();
    const generated = generate(input);
    const built = await buildDocumentModules(generated, { build: loadCompilerBuild(), flow: input.flow, values: declaredValues(input.flow), store });
    const bytes = (await store.get(built.module!.sha))!;
    expect(Buffer.byteLength(blocks)).toBeGreaterThan(3_000_000);
    expect(dom(built.html).querySelectorAll('template[data-mx-island-template]')).toHaveLength(0);
    // The deleted template resource no longer carries unopened panels; the server DOM does.
    expect(built.html).toContain(blocks.slice(3, 120));
    expect(dom(built.html).querySelector('[data-slot="tabs-content"][hidden]')?.textContent).toContain(blocks.slice(3, 120));
    expect(brotliCompressSync(bytes).byteLength).toBeLessThan(4_000);
    expect(built.templateBrBytes).toBeNull();
  }, 120_000);
  it('needs no factory resource for a small dataflow page', async () => {
    const input = await inputOf('<Helmet><Value name="name" type="string" default="Ada" /></Helmet><p>{$name}</p>');
    const store = createModuleStore();
    const built = await buildDocumentModules(generate(input), { build: loadCompilerBuild(), flow: input.flow, values: declaredValues(input.flow), store });
    // One-tree modules carry no factory resource.
    expect(built.module).not.toBeNull();
    expect(built.templateBrBytes).toBeNull();
  });
  it('keeps hostile template closers inert in the served document', async () => {
    const input = await inputOf('<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList><TabsContent value="one">safe</TabsContent><TabsContent value="two"><p>&lt;/template&gt;&lt;script&gt;alert(1)&lt;/script&gt;</p></TabsContent></Tabs>');
    const store = createModuleStore();
    const built = await buildDocumentModules(generate(input), { build: loadCompilerBuild(), flow: input.flow, values: declaredValues(input.flow), store });
    expect(built.html).not.toContain('data-mx-island-template');
    const root = dom(built.html);
    const browser = new TextDecoder().decode((await store.get(built.module!.sha))!);
    // One-tree pages render this text into the DOM, replacing the deleted template resource.
    expect(root.textContent).toContain('</template><script>alert(1)</script>');
    expect(built.html).not.toContain('</template><script>alert(1)</script>');
    expect(browser).not.toContain('alert(1)');
  });
  it('carries a large hoisted prop in the page\'s data, never in the browser module', async () => {
    const note = 'literal-prop-' + 'x'.repeat(2_000);
    const store = createModuleStore();
    const input = await inputOf(`<Question id="q" viz={{kind:"table",note:${JSON.stringify(note)}}} />`);
    const built = await buildDocumentModules(generate(input), { build: loadCompilerBuild(), flow: input.flow, values: declaredValues(input.flow), store });
    const pageData = JSON.parse(dom(built.html).querySelector('[data-mx-module-data]')!.textContent!).moduleData;
    expect(JSON.stringify(pageData)).toContain(JSON.stringify({ kind: 'table', note }));
    expect(new TextDecoder().decode((await store.get(built.module!.sha))!)).not.toContain(note);
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
  // Their liveness after hydration: one-tree.ui.test (the input) and bound-image.test (the image island).
  it('serves a native Value input with its value, as a live control of the page\'s tree', async () => {
    const page = await compilePage(await inputOf('<Helmet><Value name="region" type="string" default="west" /></Helmet><input aria-label="Region" value="$region" />'), loadCompilerBuild());
    expect(dom(page.html).querySelector('input[aria-label="Region"]')?.getAttribute('value')).toBe('west');
    expect(page.islands.flatMap((island) => island.kit)).toContain('BoundNative');
    expect(page.module!.specifiers).toContain('@mx/kit/controls');
  });

  it('hands a bound image to the image island, never serving its template as a source', async () => {
    const page = await compilePage(await inputOf('<Helmet><Value name="pick" type="string" default="https://example.test/a.png" /></Helmet><img src="$pick" alt="the pick" />'), loadCompilerBuild());
    expect(dom(page.html).querySelector('img[alt="the pick"]')).toBeTruthy();
    expect(page.html).not.toContain('src="$pick"');
    expect(page.islands.flatMap((island) => island.kit)).toContain('BoundImage');
    expect(page.module!.specifiers).toContain('@mx/kit/image');
  });

  it('serves a row image per row through the image island, its row field substituted', async () => {
    const page = await compilePage(await inputOf('<Helmet><Value name="covers" type="table" value={[{"id":1,"cover_ref":"ref:Abc123"},{"id":2,"cover_ref":"ref:Def456"}]} /></Helmet><For each={$covers}><img src="$_row.cover_ref" alt="cover" /></For>'), loadCompilerBuild());
    expect(dom(page.html).querySelectorAll('img[alt="cover"]')).toHaveLength(2);
    expect([...dom(page.html).querySelectorAll('img[alt="cover"]')].map((img) => img.getAttribute('src'))).toEqual(['/a/Abc123/raw', '/a/Def456/raw']);
    expect(page.module!.specifiers).toContain('@mx/kit/image');
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
  it('gives docs a persistent reading column and Contents from the first section', async () => {
    const input = await inputOf('<article><h1>Notes</h1><h2>First section</h2><h3>Detail</h3></article><p>Another block</p>', 'doc');
    const page = await compilePage(input, loadCompilerBuild());
    expect(dom(page.html).querySelector('.mx-doc--document > p')?.textContent).toBe('Another block');
    expect(page.outline.map(entry => entry.title)).toEqual(['Notes', 'First section', 'Detail']);
    expect(generate(input).islands).toContain('mx-doc--document');
    expect((await compilePage({ ...input, chrome: false }, loadCompilerBuild())).outline).toEqual([]);
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

  it('kit: one live tree includes tabs and accordion while cards render on the server', async () => {
    const page = await compilePage(await inputOf(fixture('kit.jsx')), loadCompilerBuild());
    // The deleted per-component island list is represented by one document hydration root.
    expect(page.islands).toHaveLength(1);
    expect(page.islands.flatMap((i) => i.kit)).toEqual(expect.arrayContaining(['Tabs', 'Accordion']));
    expect(page.module).toMatchObject({ url: expect.stringMatching(/^\/islands\/d\/[0-9a-f]{16}\.js$/), bytes: expect.any(Number) });
    expect(page.module!.imports.some((u) => u === loadCompilerBuild().manifest['@mx/rt'])).toBe(true);
    expect(page.reactStatic).toEqual([]);
    expect(page.kit.skeleton).toContain('Card');
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
    // w3-behaviour: the <DeckGL> map was the last partial one; it is an island now.
    for (const tag of STORY_UI_COMPONENT_NAME_LIST) {
      const { nodes } = parseJsx(`<div><${tag} id="x" /></div>`) as { nodes: JsxNode[] };
      let generated: ReturnType<typeof generate>;
      // A part that only renders inside its parent (AvatarImage outside Avatar) is not a component a page holds alone.
      try { generated = generate({ nodes, colorMode: 'light', template: null, chrome: true, refData: {}, flow: null }); } catch (error) { if (/must be used within/.test(String(error))) continue; throw error; }
      expect({ tag, partial: generated.partial, unported: generated.unported }).toEqual({ tag, partial: [], unported: [] });
    }
  });

  it('compiles <DeckGL> as an island in the embed family, served as today\'s box', async () => {
    const source = '<div><DeckGL id="map" className="rounded" title="Countries" height="320px" basemap="none" layers={[{"@@type":"ScatterplotLayer","getPosition":"@@=[lng, lat]"}]} /></div>';
    const input = await inputOf(source);
    const page = await compilePage(input, loadCompilerBuild());
    // Its own family (lib/islands/contract KIT_FAMILIES 'embed'): a page with a table never downloads the map's island code.
    expect(page.module!.specifiers).toContain('@mx/kit/embed');
    expect(page.module!.specifiers).not.toContain('@mx/kit/data');
    expect(page.partial).toEqual([]);
    // The deleted per-component island entries now share the one document root.
    expect(page.islands.map((i) => i.kit)).toEqual([['DeckGL']]);
    const html = dom(page.html);
    // Today's runtime adapter: the identity on the outer box, the author's class on the map's own box, the stand-in inside.
    const map = html.querySelector('#map')!;
    expect(map.getAttribute('data-mx-ast')).toBe('0.0');
    expect(shapeOf(map.outerHTML)).toEqual(shapeOf('<div id="map"><div class="rounded"><div class="w-full rounded-md bg-muted" style="height:320px" aria-busy="true" aria-label="Countries"></div></div></div>'));
  });

  it('compiles a DataTable column\'s content per row, and a control with run there as today\'s editing cell', async () => {
    const source = '<Helmet><Value name="t" type="table" value={[{"id":1,"s":"a","n":2,"w":""}]} /><Mutation name="set_s">{`update t set s=$_value where id=$_row.id`}</Mutation>'
      + '<Mutation name="set_n">{`update t set n=$_value where id=$_row.id`}</Mutation></Helmet>'
      + '<DataTable data="$t" rowKey="id" id="tbl"><Column col="id" /> <Column col="w">\n  </Column><Column col="note"><b id="n">{$_row.s}</b></Column>'
      + '<Column col="s"><Select label="S {$_row.id}" value="$_row.s" options={["a","b"]} run="$set_s" className="w-24" /></Column>'
      + '<Column col="n"><input type="number" value="$_row.n" run="$set_n" /></Column></DataTable>';
    const page = await compilePage(await inputOf(source.replace('"w":""}', '"w":"","note":""}')), loadCompilerBuild());
    // Its own family: a page without column content never loads the cells.
    expect(page.module!.specifiers).toEqual(expect.arrayContaining(['@mx/kit/cells', '@mx/kit/data']));
    const table = dom(page.html).querySelector('#tbl')!;
    // A column's content draws per row (its id made per-row); a column whose content is whitespace draws the cell as before.
    expect([...table.querySelectorAll('tbody td b')].map((b) => b.textContent)).toEqual(['a']);
    expect(table.querySelector('tbody td b')?.id).toMatch(/^mx-instance-/);
    // Today's classes, merged at compile time (tailwind-merge: the cell's flex replaces the shell's inline-flex, the author's w-24 the cell's w-full).
    const select = table.querySelector('button[aria-label="S 1"]')?.closest('.mx-control');
    expect(select?.getAttribute('class')?.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'w-24']));
    expect(select?.getAttribute('class')?.split(/\s+/)).not.toEqual(expect.arrayContaining(['inline-flex']));
    expect(select?.getAttribute('class')?.split(/\s+/)).not.toEqual(expect.arrayContaining(['w-full']));
    const number = table.querySelector('input[type="number"]');
    expect(number?.getAttribute('class')?.split(/\s+/)).toEqual(expect.arrayContaining(['h-8', 'text-right', 'tabular-nums']));
    expect(number?.getAttribute('value')).toBe('2');
  });
});

describe('one-tree identity across versions', () => {
  it('names the page\'s one hydration root by the same key whatever a version adds or changes', async () => {
    const helmet = '<Helmet><Value name="region" type="string" default="West" /><Value name="other" type="string" default="x" /></Helmet>';
    for (const body of ['<div id="w"><p id="b">{$region}</p></div>', '<div id="w"><p id="n" title="{$region}">{$other}</p><p id="b">{$other}</p></div>']) {
      const page = await compilePage(await inputOf(helmet + body), loadCompilerBuild());
      expect(page.islands.map((ref) => [ref.renderId, ref.path])).toEqual([['d-', '0']]);
      expect(dom(page.html).querySelector('[data-hk^="d-"]')).toBeTruthy();
    }
  });
});

describe('unit parity with the real kit', () => {
  it('kit: the whole compiled column, islands included, is today\'s render', async () => {
    const source = fixture('kit.jsx');
    const diffs = columnParity((await compilePage(await inputOf(source), loadCompilerBuild())).html, source);
    // Radix's Presence writes `animation-duration:0s` on closed accordion content at its FIRST mount only
    // (so a closed panel does not animate in); the Solid kit renders the steady state. Anything else is a diff.
    // Closed accordion content is now hidden but mounted, so its static descendants survive opening.
    expect(diffs.filter((d) => !d.endsWith('@style: "animation-duration:0s" vs undefined') && !d.endsWith('0 vs 1 children'))).toEqual([]);
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
  it('carries the script as data and boots even with no live control', async () => {
    const build = loadCompilerBuild();
    const input = { ...(await inputOf(fixture('prose.jsx'))), authorScript: SCRIPT };
    const page = await compilePage(input, build);
    expect(page.authorScript).toBe(SCRIPT);
    expect(page.islands).toEqual([]);
    expect(page.module, 'the page must start its store and the author host').not.toBeNull();
    expect(page.module!.imports).toEqual(expect.arrayContaining([build.manifest['@mx/boot']]));
    expect(page.ssr, 'no island renders data: the stored html is the story').toBeNull();
    // The author-script boot appends the tree's literal carrier; visible prose must stay equal.
    expect(dom(page.html).querySelector('.mx-doc')?.textContent).toBe(dom((await compilePage(await inputOf(fixture('prose.jsx')), build)).html).querySelector('.mx-doc')?.textContent);
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
    expect(page.reactStatic).toEqual([]);
    // The deleted shell classification no longer assigns a static row child to a browser island.
    expect(page.kit.skeleton).toContain('Separator');
    expect([...dom(page.html).querySelectorAll('li [data-slot="separator"]')]).toHaveLength(2);
  });
});

describe('names', () => {
  it('a hyphenated api prop is an attribute name, not a refusal', async () => {
    const page = await compilePage(await inputOf('<Helmet><Value name="q" type="string" /></Helmet><div id="w"><Input aria-label="Search" value="$q" id="i" /></div>'), loadCompilerBuild());
    expect(page.unported).toEqual([]);
    expect(dom(page.html).querySelector('#i [aria-label="Search"], #i[aria-label="Search"]')).toBeTruthy();
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

// The stand-in server half belonged to the deleted shell/island path; exercise the shipped kit below.
describe('the one-tree module path', () => {
  it('kit: the tree renders with aligned hydration keys and both modules are stored', async () => {
    const build = loadCompilerBuild();
    const input = await inputOf(fixture('kit.jsx'));
    const generated = generate(input);
    const store = createModuleStore();
    const built = await buildDocumentModules(generated, { build, flow: input.flow, values: declaredValues(input.flow), store });
    const root = dom(built.html);
    expect(built.html).not.toContain('<mx-slot');
    expect(root.querySelector('[role="tablist"]')).toBeTruthy();
    // The deleted per-island render IDs are one document prefix; static descendants remain inert.
    expect(root.querySelector('[data-hk^="d-"]')).toBeTruthy();
    expect(root.querySelector('#KpKx')).toBeTruthy();
    expect(root.querySelector('#ax0B')).toBeTruthy();
    expect(root.querySelector('#AlhE')?.hasAttribute('data-hk')).toBe(false);

    const module = built.module!;
    expect(module.url).toMatch(/^\/islands\/d\/[0-9a-f]{16}\.js$/);
    expect(module.imports).toEqual(expect.arrayContaining([build.manifest['@mx/rt'], build.manifest['@mx/boot'], build.manifest['@mx/kit/tabs'], build.manifest['@mx/kit/accordion']]));
    const bytes = (await store.get(module.sha))!;
    const text = new TextDecoder().decode(bytes);
    // The stored bytes name the runtime by specifier (bound to a build's URLs only when served, runtime-binding),
    // and Solid's DOM helpers come through the runtime's one import surface: every import is an @mx/* entry.
    expect(text).not.toMatch(/from\s*["'](\/islands\/|solid-js)/);
    const entries = new Set(Object.keys(build.manifest).filter((spec) => spec.startsWith('@mx/')));
    for (const m of text.matchAll(/from\s*"([^"]+)"/g)) expect(entries, m[1]).toContain(m[1]);
    expect(module.specifiers).toEqual(expect.arrayContaining(['@mx/rt', '@mx/boot', '@mx/kit/tabs', '@mx/kit/accordion']));
    const bound = bindModuleCode(text, build);
    for (const m of bound.matchAll(/from\s*"([^"]+)"/g)) expect(Object.values(build.manifest), m[1]).toContain(m[1]);
    const br = brotliCompressSync(bytes).byteLength;
    // Target 2's per-document share (the brief: ≤ 5 KB br for the kit fixture); measured 2283 B raw / 614 B br.
    expect(br, `kit per-document module: ${bytes.byteLength} B raw, ${br} B br`).toBeLessThanOrEqual(5 * 1024);

    // The SSR module holds the whole page: it is stored where no route serves it, never beside the browser module.
    expect(built.ssr!.url).toBe(`islands-ssr/${built.ssr!.sha}`);
    expect(await store.get(built.ssr!.sha)).toBeNull();
    const ssr = await loadSsrModule(built.ssr!);
    expect(ssr.render({ values: {}, results: null, mermaidImages: {}, drawings: {} })).toBe(built.html.replace(/<script type="application\/json" data-mx-island-literals[\s\S]*$/, ''));
    const again = await buildDocumentModules(generate(input), { build, flow: input.flow, values: declaredValues(input.flow), store });
    expect(again.module!.sha).toBe(module.sha);
    expect(again.ssr!.sha).toBe(built.ssr!.sha);
  });

  it('dashboard: once the server has the question\'s rows, the served chart box is the slot named for the question', async () => {
    const input = await inputOf(fixture('dashboard.jsx').replaceAll('{{sales}}', 'SALES1'), 'dashboard');
    const built = await buildDocumentModules(generate(input), { build: loadCompilerBuild(), flow: input.flow, values: declaredValues(input.flow), store: createModuleStore() });
    const ssr = await loadSsrModule(built.ssr!);
    const monthly = { columns: [{ name: 'month', type: 'date' }, { name: 'revenue', type: 'number' }], rows: [{ month: '2026-01-01', revenue: 3 }] };
    const html = ssr.render({ values: declaredValues(input.flow), results: { tables: { monthly }, errors: {} } as never, mermaidImages: {}, drawings: {} });
    expect(dom(html).querySelector(`[${CHART_SLOT_ATTR}="AVkX"]`)).toBeTruthy();
  });
});

describe('the generated modules, compiled', () => {
  it('the browser and SSR modules are structure independent for benign and hostile author strings too', async () => {
    const build = loadCompilerBuild();
    const verdict = await structureIndependent(async (doc) => {
      const generated = generate(doc);
      // The deleted standalone skeleton render is replaced by the one-tree SSR source.
      return { skeleton: await ssrModuleCode(generated.skeleton, doc.flow, generated.staticTexts, generated.staticHtml), islands: (await browserModuleCode(generated.browserIslands, build)).code };
    });
    expect(verdict).toEqual({ skeletonIndependent: true, islandsIndependent: true, leaked: [] });
  });
});
