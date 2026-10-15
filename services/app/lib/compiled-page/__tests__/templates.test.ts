/**
 * THE COMPILER AND TEMPLATES: a string that reads the page makes only its own element live — its static
 * siblings and children stay server HTML — and a page without one compiles exactly as before (the
 * template paths are taken only for a value or cell hole; row templates keep their row paths).
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { compilePage, generate } from '../compiler';
import { loadCompilerBuild } from '../build.server';
import { loadKitServer } from '../bundle.server';
import type { CompileInput } from '../contract';
import { prepareStoryParts } from '@/lib/publish/prepared/prepare-runtime.server';
import { compileDataflow, prepareCompile, type ImportSource } from '@/lib/dataflow/server';
import { dataflowOf, splitHelmet } from '@/lib/document/helmet';
import { parseJsx, type JsxNode } from '@/lib/jsx';

const SOURCES: Record<string, ImportSource> = {
  Sales0001: { kind: 'dataset', tables: [{ name: 'rows', columns: [{ name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }] }] },
};
async function inputOf(source: string): Promise<CompileInput> {
  const { runtime } = await prepareStoryParts({ source, compiledCss: null, theme: null, colorMode: 'light', title: 't', template: null, refData: {}, assetUrls: new Set() });
  const parsed = parseJsx(source) as { nodes: JsxNode[] };
  const { content, body } = splitHelmet(parsed.nodes);
  const declared = dataflowOf(content);
  let flow = null;
  if (declared.imports.length || declared.values.length || declared.queries.length) {
    const result = compileDataflow(declared, await prepareCompile(declared, async (ref) => SOURCES[ref] ?? null), body);
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '));
    flow = result.compiled;
  }
  return { nodes: runtime.data.nodes, colorMode: 'light', template: null, chrome: true, glyphs: runtime.data.glyphs, refData: {}, flow, build: loadCompilerBuild().id };
}
const HELMET = '<Helmet><Import name="sales" src="ref:Sales0001" /><Value name="region" type="string" default="West" /><Value name="link" type="string" default="https://example.test/ok" />'
  + '<Query name="share">{`select round(100.0 * sum(case when region = $region then revenue end) / sum(revenue), 1) as pct from sales.rows`}</Query></Helmet>';

describe('only the templated element is live', () => {
  it('keeps static siblings as server HTML and emits one guarded attribute spread', async () => {
    const input = await inputOf(`${HELMET}<section id="s"><h2 id="h">Static heading</h2><a id="go" href="{$link}" className="underline">Open</a><p id="p">Static paragraph</p></section>`);
    const generated = generate({ ...input, kitServer: await loadKitServer() });
    expect(generated.staticHtml.join('')).toContain('Static heading');
    expect(generated.staticHtml.join('')).toContain('Static paragraph');
    expect(generated.browserIslands).toContain('tplAttrs(');
    expect(generated.browserIslands).toContain("from '@mx/kit/templates'");
    expect(generated.browserIslands).not.toContain('Static heading');
    const page = await compilePage(input, loadCompilerBuild());
    const doc = new JSDOM(page.html).window.document;
    expect(doc.querySelector('#go')!.getAttribute('href')).toBe('https://example.test/ok');
    expect(doc.querySelector('#go')!.getAttribute('class')).toBe('underline');
    expect(page.islands[0]?.readsData).toBe(true);
  });

  it('fills a chart title and spec reactively, and flags the chart as templated', async () => {
    const input = await inputOf(`${HELMET}<Chart id="q" data="$share" title="Share, {$region}" viz={{"kind":"vega-lite","spec":{"title":"{$region}","mark":"bar","encoding":{"x":{"field":"pct","type":"quantitative"}}}}} />`);
    const generated = generate({ ...input, kitServer: await loadKitServer() });
    expect(generated.browserIslands).toContain('tplText(');
    expect(generated.browserIslands).toContain('tplViz(');
    expect(generated.browserIslands).toMatch(/ templated=\{/);
  });

  it('leaves a page without value templates on its old paths', async () => {
    const plain = await inputOf(`${HELMET}<section><h2>Static</h2><a href="https://example.test/{x}">Open {"{$literal}"}</a></section><For each={$share}><p title="{$_row.pct}">{$_row.pct}</p></For>`);
    const generated = generate({ ...plain, kitServer: await loadKitServer() });
    for (const call of ['tplAttrs(', 'tplText(', 'tplViz(', '@mx/kit/templates']) expect(generated.browserIslands).not.toContain(call);
  });
});
