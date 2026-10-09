/**
 * The compiled page's tail data blocks (lib/compiled-page/carriers): what the compiler writes is what
 * serve, the assembler and the offline file read back, byte for byte.
 */
import { describe, expect, it, vi } from 'vitest';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { prepareStoryParts } from '@/lib/story/prepared/prepare-runtime.server';
import { compileDataflow, prepareCompile } from '@/lib/dataflow/compile-dataflow';
import { dataflowOf, splitHelmet } from '@/lib/story/document/helmet';
import { compilePage } from '../compiler';
import { loadCompilerBuild } from '../build.server';
import {
  LITERALS_ATTR, MODULE_DATA_ATTR, emitCarriers, literalsReadCode, splitCarriers, withModuleDataId, withStoredCarriers,
} from '../carriers';
import { ISLAND_DATA_ID } from '../contract';

const KEY = 'aaaaaaaaaaaaaaaa';
/** One carrier tag's JSON text: after its opener's `>`, before the closing tag. */
const literalsText = (tag: string): unknown => JSON.parse(tag.slice(tag.indexOf('>') + 1, -'</script>'.length));

describe('carriers', () => {
  it('writes the stored wire format exactly (stored pages are served unchanged)', () => {
    expect(LITERALS_ATTR).toBe('data-mx-island-literals');
    expect(MODULE_DATA_ATTR).toBe('data-mx-module-data');
    expect(emitCarriers({ literals: ['a&b', '<i>'], key: KEY }, [{ rows: [1] }])).toBe(
      `<script type="application/json" data-mx-island-literals="${KEY}">["a\\u0026b","\\u003ci\\u003e"]</script>`
      + '<script type="application/json" data-mx-module-data>{"moduleData":[{"rows":[1]}]}</script>',
    );
    expect(emitCarriers(null, null)).toBe('');
    expect(emitCarriers({ literals: [], key: KEY }, [])).toBe('');
    expect(literalsReadCode(KEY)).toBe(`const $mxL=JSON.parse(document.querySelector('script[data-mx-island-literals="${KEY}"]').textContent);\n`);
  });

  it('round-trips emitCarriers through splitCarriers', () => {
    const literals = ['chart', 'label'];
    const moduleData = [{ rows: [1, 2] }, 'text', null];
    const tags = emitCarriers({ literals, key: KEY }, null);
    const split = splitCarriers(`<div class="mx-doc">seed</div>${emitCarriers({ literals, key: KEY }, moduleData)}`);
    expect(split.story).toBe('<div class="mx-doc">seed</div>');
    expect(split.literals).toBe(tags);
    expect(literalsText(split.literals)).toEqual(literals);
    expect(split.moduleData).toEqual(moduleData);
    expect(split.moduleDataTag).toBe(emitCarriers(null, moduleData));
  });

  it('keeps a literal containing </script or U+2028 inside its carrier', () => {
    const hostile = ['</script><script>alert(1)</script>', 'line sep para'];
    const tags = emitCarriers({ literals: hostile, key: KEY }, [{ value: hostile[0] }]);
    expect(tags.split('</script>')).toHaveLength(3);
    expect(tags).not.toContain(' ');
    expect(tags).not.toContain(' ');
    const split = splitCarriers(`<p>x</p>${tags}`);
    expect(split.story).toBe('<p>x</p>');
    expect(literalsText(split.literals)).toEqual(hostile);
    expect(split.moduleData).toEqual([{ value: hostile[0] }]);
  });

  it('leaves html with no carriers as it is', () => {
    const html = '<div class="mx-doc"><script type="application/json" data-other>{}</script></div>';
    expect(splitCarriers(html)).toEqual({ story: html, literals: '', moduleData: null, moduleDataTag: '' });
  });

  it('reads two literal tags plus one module-data tag', () => {
    const second = 'bbbbbbbbbbbbbbbb';
    const one = emitCarriers({ literals: ['one'], key: KEY }, null);
    const two = emitCarriers({ literals: ['two'], key: second }, null);
    const data = emitCarriers(null, [{ rows: [1] }]);
    const split = splitCarriers(`<div>a</div>${one}<div>b</div>${two}${data}`);
    expect(split).toEqual({ story: '<div>a</div><div>b</div>', literals: one + two, moduleData: [{ rows: [1] }], moduleDataTag: data });
  });

  it('rejects a module-data carrier that is not { moduleData: [] }', () => {
    expect(() => splitCarriers(`<p>x</p><script type="application/json" data-mx-module-data>{"rows":[]}</script>`)).toThrow(/module data/);
  });

  it('withStoredCarriers adds the stored carriers to a fresh render, and never duplicates them', () => {
    const tail = emitCarriers({ literals: ['chart'], key: KEY }, [{ rows: [1] }]);
    const stored = `<div class="mx-doc">seed</div>${tail}`;
    expect(withStoredCarriers('<div class="mx-doc">fresh</div>', stored)).toBe(`<div class="mx-doc">fresh</div>${tail}`);
    expect(withStoredCarriers(stored, stored)).toBe(stored);
    const fresh = `<div class="mx-doc">fresh</div>${emitCarriers({ literals: ['other'], key: 'cccccccccccccccc' }, [{ rows: [2] }])}`;
    expect(withStoredCarriers(fresh, stored)).toBe(fresh);
    // Only the missing kind is taken from the stored render.
    const freshLiterals = `<div>f</div>${emitCarriers({ literals: ['own'], key: 'cccccccccccccccc' }, null)}`;
    expect(withStoredCarriers(freshLiterals, stored)).toBe(`${freshLiterals}${emitCarriers(null, [{ rows: [1] }])}`);
    expect(withStoredCarriers('<p>fresh</p>', '<p>nothing stored</p>')).toBe('<p>fresh</p>');
  });

  it('parses the module data once on the serve path (stored html served as it is)', () => {
    const stored = `<p>x</p>${emitCarriers({ literals: ['chart'], key: KEY }, [{ rows: [1] }])}`;
    const parse = vi.spyOn(JSON, 'parse');
    try {
      expect(splitCarriers(withStoredCarriers(stored, stored)).moduleData).toEqual([{ rows: [1] }]);
      expect(parse).toHaveBeenCalledTimes(1);
    } finally { parse.mockRestore(); }
  });

  it('gives the module-data carrier the page data id the browser module reads (the offline file)', () => {
    for (const attribute of ['data-mx-module-data', 'data-mx-module-data=""']) {
      expect(withModuleDataId(`<p>x</p><script type="application/json" ${attribute}>{"moduleData":[]}</script>`))
        .toBe(`<p>x</p><script type="application/json" id="${ISLAND_DATA_ID}" data-mx-module-data>{"moduleData":[]}</script>`);
    }
    expect(withModuleDataId('<p>none</p>')).toBe('<p>none</p>');
  });

  it('parses a page the compiler produced back to the structures it wrote', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ label: `row ${i}: ${'x'.repeat(120)}` }));
    const source = `<Helmet><Value name="rows" type="table" value={${JSON.stringify(rows)}} /></Helmet><For each={$rows}><p>$_row.label</p></For><Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger></TabsList><TabsContent value="one"><p>Static panel</p></TabsContent></Tabs>`;
    const { runtime } = await prepareStoryParts({ source, compiledCss: null, theme: null, colorMode: 'light', title: 't', template: null, refData: {}, assetUrls: new Set() });
    const { content, body } = splitHelmet((parseJsx(source) as { nodes: JsxNode[] }).nodes);
    const declared = dataflowOf(content);
    const flow = compileDataflow(declared, await prepareCompile(declared, async () => null), body);
    if (!flow.ok) throw new Error(flow.errors.map((e) => e.message).join('; '));
    const build = loadCompilerBuild();
    const compiled = await compilePage({ nodes: runtime.data.nodes, colorMode: 'light', template: null, chrome: true, glyphs: runtime.data.glyphs, refData: {}, flow: flow.compiled, build: build.id }, build);
    const split = splitCarriers(compiled.html);
    expect(split.literals).toContain(`${LITERALS_ATTR}="`);
    expect(JSON.stringify(split.moduleData)).toContain(rows[0]!.label);
    expect(split.story).toContain('Static panel');
    expect(split.story).not.toContain(LITERALS_ATTR);
    expect(split.story).not.toContain(MODULE_DATA_ATTR);
    const key = new RegExp(`${LITERALS_ATTR}="([0-9a-f]{16})"`).exec(split.literals)![1]!;
    // Written once, at the tail, in this order: parsing and writing again gives the stored bytes.
    expect(split.story + emitCarriers({ literals: literalsText(split.literals) as string[], key }, split.moduleData)).toBe(compiled.html);
  });
});
