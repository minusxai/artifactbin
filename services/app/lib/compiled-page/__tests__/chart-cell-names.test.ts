/**
 * `<Chart>`/`<Cell>` and their earlier names `<Question>`/`<Number>` compile to the same page: the parser is the one
 * alias point (lib/jsx/component-names COMPONENT_ALIASES), so the compiler only ever sees the new names, and the
 * served DOM — the reader's and the editor's contract — does not change with the spelling.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { compilePage } from '../compiler';
import { loadCompilerBuild } from '../build.server';
import type { CompileInput } from '../contract';
import { prepareStoryParts } from '@/lib/publish/prepared/prepare-runtime.server';
import { compileDataflow, prepareCompile } from '@/lib/dataflow/server';
import { dataflowOf, splitHelmet } from '@/lib/document/helmet';
import { parseJsx, type JsxNode } from '@/lib/jsx';

async function pageOf(source: string) {
  const { runtime } = await prepareStoryParts({ source, compiledCss: null, theme: null, colorMode: 'light', title: 't', template: null, refData: {}, assetUrls: new Set() });
  const parsed = parseJsx(source) as { nodes: JsxNode[] };
  const { content, body } = splitHelmet(parsed.nodes);
  const declared = dataflowOf(content);
  const compiled = compileDataflow(declared, await prepareCompile(declared, async () => null), body);
  if (!compiled.ok) throw new Error(compiled.errors.map((e) => e.message).join('; '));
  const input: CompileInput = { nodes: runtime.data.nodes, colorMode: 'light', template: null, chrome: true, glyphs: runtime.data.glyphs, refData: {}, flow: compiled.compiled, build: loadCompilerBuild().id };
  return compilePage(input, loadCompilerBuild());
}

const HELMET = '<Helmet><Value name="sales" type="table" value={[{"region":"East","revenue":1200},{"region":"West","revenue":800}]} /></Helmet>';
const VIZ = '{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"region","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}}}';
const body = (chart: string, cell: string) =>
  `${HELMET}<div id="report"><p id="lead">Top region <${cell} id="top" data="$sales" col="region" /> earned <${cell} id="total" data="$sales" col="revenue" agg="sum" format="$,.0f" />.</p>`
  + `<${chart} id="by-region" title="Revenue by region" data="$sales" viz={${VIZ}} /><${chart} id="rows" data="$sales" /></div>`;

describe('the earlier names compile to the same page', () => {
  it('serves identical HTML and imports the same kit components for Question/Number and Chart/Cell', async () => {
    const [before, after] = await Promise.all([pageOf(body('Question', 'Number')), pageOf(body('Chart', 'Cell'))]);
    expect(before.unported).toEqual([]);
    expect(after.html).toBe(before.html);
    expect(after.kit).toEqual(before.kit);
    expect(after.kit.islands).toEqual(expect.arrayContaining(['Chart', 'Cell']));
    const page = new JSDOM(`<div>${after.html}</div>`).window.document;
    expect(page.querySelector('#top')?.textContent).toBe('East');
    expect(page.querySelector('#total')?.textContent).toBe('$2,000');
    expect(page.querySelector('#lead')?.tagName).toBe('P');
    expect(page.querySelectorAll('[aria-label="Question embed"]')).toHaveLength(2);
  });
});
