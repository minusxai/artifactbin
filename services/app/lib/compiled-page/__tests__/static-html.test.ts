/**
 * STATIC CHUNKS (compiler `staticHtml`): a static plain-HTML subtree is rendered by the compiler, not by
 * Babel and Solid. The served bytes must be Solid's own: every corpus document (the p3-static corpus, the
 * kitchen sink, one snippet per tag) and the edge shapes below compile to the same HTML and the same
 * browser module with and without the chunks.
 */
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { compilePage, declaredValues, generate } from '../compiler';
import { buildDocumentModules, loadKitServer, ssrTransformStats } from '../bundle.server';
import { loadCompilerBuild } from '../build.server';
import { createModuleStore } from '../modules.server';
import type { CompileInput } from '../contract';
import { corpus, type CorpusDoc } from './p3-static/corpus';
import { inputOf } from './p3-static/harness';

const edge = (key: string, body: string): CorpusDoc => ({ key, group: 'tag', template: null, markup: `<div data-design="tw" className="px-6" id="root">${body}</div>` });
const LONG = `${'word  with\ttabs and nbsp &amp; &lt;b&gt; '.repeat(40)}end`;

/** The shapes where Solid's server template does something implicit: whitespace, escaping, booleans, voids, casing. */
const EDGES: CorpusDoc[] = [
  edge('text-whitespace', `<p>  two  spaces\tand\ttabs  nbsp ls ps  </p><p>{"  literal  & < > \\" ' "}</p><p>{42}{"x"}{7}</p><p>a<b>b</b>c<i>d</i></p>`),
  edge('text-entities', '<p>&amp; &lt; &gt; &quot; &#39; &#123;braces&#125; &nbsp;nbsp &copy;</p><p>{"{braces}"} and {`template`}</p>'),
  edge('text-lines', '<pre>line one\n  line two\n\n\tline three</pre><p>\n  wrapped\n  text\n</p><div>\n<span>a</span>\n<span>b</span>\n</div>'),
  edge('text-long', `<p>${LONG}</p><section><p>${LONG}</p><p>short</p></section>`),
  edge('text-single', '<p>only</p><p><b>only element</b></p><p></p><div><p>x</p></div>'),
  edge('attrs-quoting', `<p title="it's &quot;quoted&quot; & <tagged>" className="  a   b  " style={{ color: 'red', marginTop: 4, '--x': ' y ' }} data-x="" aria-label="l &amp; m" id="q1">x</p>`),
  edge('attrs-boolean', '<details open id="d1"><summary>s</summary><p hidden>h</p></details><button disabled type="button">b</button><input type="checkbox" checked readOnly /><fieldset disabled><legend>l</legend></fieldset><ol reversed start={3}><li>x</li></ol>'),
  edge('attrs-cased', '<label htmlFor="f1" tabIndex={0}>l</label><div contentEditable="true" spellCheck="false">e</div><td colSpan={2} rowSpan={3}>c</td><img src="https://example.com/a.png" alt="a" width={10} height="20" /><a href="javascript:alert(1)">bad</a><a href="https://example.com/?a=1&b=2" target="_blank" rel="noreferrer">ok</a>'),
  edge('svg', '<svg viewBox="0 0 10 10" width="10"><g fill="none" stroke="currentColor" strokeWidth={2}><path d="M0 0L10 10" /><circle cx="5" cy="5" r="2" /></g><linearGradient id="lg"><stop offset="0" /></linearGradient></svg><svg><rect x="1" y="1" width="2" height="2"></rect></svg>'),
  edge('forms', '<select defaultValue="b" name="s"><option value="a">A</option><option value="b">B</option><option>c</option></select><textarea defaultValue="x < y & z" rows={2} /><textarea>inline</textarea><input value="v" placeholder="p > q" />'),
  edge('voids', '<p>a<br />b<wbr />c</p><hr className="my-2" /><table><colgroup><col span={2} /></colgroup><tbody><tr><td>1</td><td>2</td></tr></tbody></table><video controls src="https://example.com/v.mp4"><source src="https://example.com/v.webm" type="video/webm" /><track kind="captions" /></video>'),
  edge('mixed', '<Helmet><Value name="who" type="string" default="Ada" /></Helmet><section><h2>Static</h2><p>Hello {$who}</p><ul><li>one</li><li>two <Badge>b</Badge></li></ul><Card><p>in card</p><span>and</span></Card></section>'),
];

async function compileBoth(input: CompileInput) {
  const build = loadCompilerBuild();
  const base = { ...input, glyphCatalogUrl: build.manifest['@mx/glyphs'] };
  const chunked = generate({ ...base, kitServer: await loadKitServer() });
  const jsx = generate({ ...base, staticHtml: false });
  const options = { build, flow: input.flow, values: declaredValues(input.flow), store: createModuleStore() };
  const [fast, reference] = [await buildDocumentModules(chunked, options), await buildDocumentModules(jsx, options)];
  return { chunked, jsx, fast, reference };
}

describe('static chunks', () => {
  it('serve every corpus and edge document byte for byte as the all-JSX skeleton does', async () => {
    let chunks = 0;
    const kitChunks = new Set<string>();
    for (const doc of [...await corpus(), ...EDGES]) {
      const input = await inputOf(doc).catch((error: unknown) => { throw new Error(`${doc.key}: ${String(error)}`); });
      const { chunked, jsx, fast, reference } = await compileBoth(input);
      expect(fast.html, doc.key).toBe(reference.html);
      expect(fast.module?.sha, doc.key).toBe(reference.module?.sha);
      expect(chunked.browserIslands, doc.key).toBe(jsx.browserIslands);
      expect(chunked.islandRefs, doc.key).toEqual(jsx.islandRefs);
      expect(chunked.kit.islands, doc.key).toEqual(jsx.kit.islands);
      chunks += chunked.staticHtml.length;
      for (const html of chunked.staticHtml) for (const [, slot] of html.matchAll(/data-slot="([a-z-]+)"/g)) kitChunks.add(slot!);
    }
    // The chunks are exercised, not bypassed — the kit's among them.
    expect(chunks).toBeGreaterThan(100);
    expect([...kitChunks]).toEqual(expect.arrayContaining(['table', 'table-row', 'table-cell', 'card', 'card-content', 'badge', 'icon', 'separator', 'alert']));
  }, 240_000);

  it('keeps a heavy static document out of the module Babel transforms', async () => {
    const table = (t: number, rows: number) => `<h2 className="mt-8">Table ${t}</h2><p>Notes for table ${t}: alpha &amp; beta.</p><table className="text-sm"><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead><tbody>${
      Array.from({ length: rows }, (_, r) => `<tr><td>row ${r} golf</td><td>${r * 17}</td><td><span className="text-muted-foreground">note ${r}</span></td></tr>`).join('')}</tbody></table>`;
    const doc = (rows: number): CorpusDoc => edge(`heavy-${rows}`, `<Helmet><Value name="who" type="string" default="Ada" /></Helmet><p>Hi {$who}</p>${Array.from({ length: 28 }, (_, t) => table(t, rows)).join('')}`);
    const small = await compileBoth(await inputOf(doc(6)));
    expect(small.fast.html).toBe(small.reference.html);
    const heavy = generate(await inputOf(doc(100)));
    expect(heavy.staticHtml.join('')).toContain('row 99 golf');
    expect(heavy.skeleton.length).toBeLessThan(20_000);
  }, 120_000);

  it('re-transforms nothing when a draft edits only static text', async () => {
    const build = loadCompilerBuild();
    const draft = async (text: string) => {
      const input = await inputOf(edge('draft', `<Helmet><Value name="who" type="string" default="Ada" /></Helmet><p>Hi {$who}</p><p id="typed">${text}</p><ul><li>static</li></ul>`));
      return buildDocumentModules(generate(input), { build, flow: input.flow, values: declaredValues(input.flow), store: createModuleStore() });
    };
    await draft('first');
    const before = ssrTransformStats();
    const edited = await draft('first, then more');
    const after = ssrTransformStats();
    expect(after.misses).toBe(before.misses);
    expect(after.hits).toBe(before.hits + 1);
    expect(edited.html).toContain('first, then more');
    // A change to the dynamic tree is a new source: transformed, not served from the cache.
    await (async () => {
      const input = await inputOf(edge('draft', `<Helmet><Value name="who" type="string" default="Ada" /></Helmet><p>Hi {$who} and {$who}</p><p id="typed">x</p>`));
      await buildDocumentModules(generate(input), { build, flow: input.flow, values: declaredValues(input.flow), store: createModuleStore() });
    })();
    expect(ssrTransformStats().misses).toBe(after.misses + 1);
  }, 60_000);

  it('compiles a kit-table report (28 kit Tables × 30 rows and a chart) in two seconds, its tables as static chunks', async () => {
    const cell = (t: number, r: number, c: number, body: string, cls = '') => `<TableCell${cls ? ` className="${cls}"` : ''} id="c${t}_${r}_${c}">${body}</TableCell>`;
    const row = (t: number, r: number) => `<TableRow id="r${t}_${r}">${cell(t, r, 0, `Item ${r} golf`)}${cell(t, r, 1, String(r * 17), 'text-right tabular-nums')}${cell(t, r, 2, `<Badge variant="secondary" id="b${t}_${r}">ok</Badge>`)}${cell(t, r, 3, `note ${r} with <strong>bold</strong> &amp; text`)}</TableRow>`;
    const table = (t: number) => `<h2 className="mt-8 text-xl font-semibold" id="h${t}">Section ${t}</h2><p className="text-sm text-muted-foreground" id="p${t}">Notes for ${t}: alpha &amp; beta.</p>`
      + `<Card id="k${t}"><CardContent id="kc${t}"><Table id="t${t}"><TableHeader id="th${t}"><TableRow id="tr${t}">${['Name', 'Value', 'State', 'Notes'].map((h, i) => `<TableHead id="hd${t}_${i}">${h}</TableHead>`).join('')}</TableRow></TableHeader>`
      + `<TableBody id="tb${t}">${Array.from({ length: 30 }, (_, r) => row(t, r)).join('')}</TableBody></Table></CardContent></Card>`;
    const markup = `<Helmet><Import name="sales" src="ref:SALES1" /><Query name="monthly">{\`select month, sum(revenue) as revenue from sales.rows group by 1 order by 1\`}</Query></Helmet>`
      + `<div data-design="tw" className="px-6" id="root"><h1 className="text-3xl font-bold" id="title">Report</h1>`
      + `<Question title="Revenue" data="$monthly" height="300px" viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"month","type":"temporal"},"y":{"field":"revenue","type":"quantitative"}}}}} id="q1" />`
      + `${Array.from({ length: 28 }, (_, t) => table(t)).join('')}</div>`;
    const input = await inputOf({ key: 'kit-report', group: 'tag', markup, template: null });
    const build = loadCompilerBuild();
    // The process's first compile loads the build's server half; the measured one is this document's first.
    await compilePage(await inputOf(edge('warm', '<Card><Table><TableBody><TableRow><TableCell>w</TableCell></TableRow></TableBody></Table></Card>')), build);
    const generated = generate({ ...input, kitServer: await loadKitServer() });
    expect(generated.staticHtml.join('')).toMatch(/<td data-slot="table-cell" class="[^"]*" data-mx-ast="[\d.]+" id="c27_29_0"/);
    expect(generated.skeleton.length).toBeLessThan(40_000);
    const start = performance.now();
    const page = await compilePage(input, build);
    const cold = performance.now() - start;
    const again = performance.now();
    await compilePage(input, build);
    const warm = performance.now() - again;
    if (process.env.P3_REPORT_DIR) writeFileSync(`${process.env.P3_REPORT_DIR}/kit-report.json`, JSON.stringify({ source: markup.length, html: page.html.length, first: cold, again: warm }));
    expect(page.html).toContain('Item 29 golf');
    expect(cold).toBeLessThan(2_000);
  }, 120_000);
});
