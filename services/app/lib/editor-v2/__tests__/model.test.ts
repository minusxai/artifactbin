import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { splitBlock } from 'prosemirror-commands';
import { validateJsx } from '@/lib/jsx/validate';
import { serializeJsx } from '@/lib/jsx';
import {
  editorDocument,
  sourceNodes,
  normalizeIdentities,
  pasteFragment,
  toggleInline,
} from '../model';
import { clipboardAst } from '../clipboard';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

function state(source: string) {
  const parsed = parseJsxOrThrow(source);
  return EditorState.create({ doc: editorDocument(parsed.nodes) });
}
function source(s: EditorState) {
  return serializeJsx(sourceNodes(s.doc));
}
describe('source-backed editor transactions', () => {
  it('replaces a range across paragraphs and retains the surviving identity', () => {
    let s = state('<p id="first" className="lead">alpha</p><p id="second">bravo</p>');
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 3, 10)).insertText('X'));
    expect(source(s)).toBe('<p id="first" className="lead">alXavo</p>');
  });
  it('splits without copying the authored identity onto a second paragraph', () => {
    let s = state('<p id="first" className="lead">alpha</p>');
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 3)));
    splitBlock(s, (tr) => {
      s = s.apply(normalizeIdentities(tr));
    });
    const result = source(s);
    expect(result.match(/id="first"/g)).toHaveLength(1);
    expect(result).toContain('al</p><p');
    expect(result).toContain('pha</p>');
  });
  it('preserves authored inline metadata but cannot introduce it through paste', () => {
    let s = state('<p id="p"><span className="accent">one</span> two</p>');
    expect(source(s)).toBe('<p id="p"><span className="accent">one</span> two</p>');
    s = s.apply(
      s.tr
        .setSelection(TextSelection.create(s.doc, 1, 8))
        .replaceSelection(pasteFragment(clipboardAst('html', '<p id="stolen" class="bad"><strong>new</strong></p>'))),
    );
    expect(source(s)).not.toMatch(/stolen|bad/);
    expect(source(s)).toContain('<strong>new</strong>');
  });
});

it('bold toggling preserves an existing italic range and affects only selected text', () => {
  let s = state('<p><em>alpha</em> bravo</p>');
  s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 2, 4)));
  s = s.apply(toggleInline(s, 'strong'));
  expect(source(s)).toContain('<strong>lp</strong>');
  expect(source(s)).toContain('<em>');
  s = s.apply(toggleInline(s, 'strong'));
  expect(source(s)).not.toContain('<strong>');
  expect(s.doc.textContent).toBe('alpha bravo');
});

it('represents nested list items as blocks instead of block-shaped inline marks', () => {
  const s = state('<ul id="list"><li id="item">one<ul id="nested"><li id="child">two</li></ul></li></ul>');
  const marks: string[] = [];
  s.doc.descendants((n) => {
    for (const m of n.marks) marks.push(m.attrs.tag);
  });
  expect(marks).not.toContain('ul');
  expect(marks).not.toContain('li');
  expect(source(s)).toBe('<ul id="list"><li id="item">one<ul id="nested"><li id="child">two</li></ul></li></ul>');
});

it('assigns stable unique identities before sending a split or pasted fragment', () => {
  let s = state('<p id="first">alpha</p>');
  s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 3)));
  splitBlock(s, (tr) => {
    s = s.apply(normalizeIdentities(tr, true));
  });
  const before = source(s),
    ids = [...before.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  s = s.apply(normalizeIdentities(s.tr.insertText('more'), true));
  expect([...source(s).matchAll(/id="([^"]+)"/g)].map((m) => m[1])).toEqual(ids);
});

it('rejects positioned dimensions on flow columns at the publish boundary', () => {
  const parsed = parseJsxOrThrow('<Grid mode="flow"><GridItem w={6} h={2} x={0}><p>text</p></GridItem></Grid>');
  expect(validateJsx(parsed.nodes, { components: ['Grid', 'GridItem'] })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining('minHeight'),
      }),
    ]),
  );
});

it('does not duplicate inline identities when a marked run is split by a paragraph', () => {
  let s = state('<p id="p"><strong id="bold">alpha</strong></p>');
  s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 3)));
  splitBlock(s, (tr) => {
    s = s.apply(normalizeIdentities(tr, true));
  });
  const ids = [...source(s).matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  expect(new Set(ids).size).toBe(ids.length);
  expect(source(s)).toContain('id="bold"');
});

describe('reading-mode parity of the parsed document', () => {
  const doc = (s: string) => editorDocument(parseJsxOrThrow(s).nodes);
  it('collapses source indentation and line breaks the way the reader lays them out', () => {
    const parsed = doc('<header>\n  <h1 id="t">\n    Among mainstream languages,\n    dynamic looks cheaper.\n  </h1>\n  <p id="l">Has <strong>bold</strong> and\n    <a href="https://example.com">a link</a>\n  </p>\n</header>');
    expect(parsed.child(0).child(0).textContent).toBe('Among mainstream languages, dynamic looks cheaper.');
    expect(parsed.child(0).child(1).textContent).toBe('Has bold and a link');
    expect(serializeJsx(sourceNodes(parsed))).toBe('<header><h1 id="t">Among mainstream languages, dynamic looks cheaper.</h1><p id="l">Has <strong>bold</strong> and <a href="https://example.com">a link</a></p></header>');
  });
  it('drops the space around a line break and keeps pre text verbatim', () => {
    const parsed = doc('<div><p>one \n <br /> two</p><pre>  a\n    b</pre></div>');
    expect(serializeJsx(sourceNodes(parsed))).toBe('<div><p>one<br />two</p><pre>  a\n    b</pre></div>');
  });
  it('keeps one typed trailing space at the end of a block, but not source formatting', () => {
    expect(doc('<p id="a">### </p>').child(0).textContent).toBe('### ');
    expect(doc('<p id="a">Has <strong>bold</strong> </p>').child(0).textContent).toBe('Has bold');
    expect(doc('<p id="a">text\n  </p>').child(0).textContent).toBe('text');
    expect(doc('<p id="a">text  </p>').child(0).textContent).toBe('text');
  });
  it('keeps childless inline elements (legend swatches) with their attributes through a round trip', () => {
    const source = '<div id="legend" className="flex gap-4"><span id="a"><span className="inline-block size-2.5 bg-[#7b6fe0]" id="sw"></span> static</span></div>';
    const parsed = doc(source);
    expect(serializeJsx(sourceNodes(parsed))).toBe(source);
    const atom = parsed.child(0).child(0).child(0);
    expect(atom.type.name).toBe('inline_atom');
    expect(atom.marks.map((m) => m.attrs.tag)).toEqual(['span']);
  });
  it('draws a rule with its authored class, as the reader does', () => {
    const rule = doc('<hr id="r" className="my-8" />').child(0);
    expect(rule.type.spec.toDOM!(rule)).toEqual(['hr', { id: 'r', class: 'my-8' }]);
  });
  it('renders a container’s own inline run without a themed box of its own', () => {
    const run = doc('<div className="flex"><span>a</span><span>b</span></div>').child(0).child(0);
    expect(run.attrs.synthetic).toBe(true);
    const spec = run.type.spec.toDOM!(run) as [string, Record<string, string>, number];
    expect(spec[0]).toBe('span');
    expect(spec[1].style).toBe('display: contents');
  });
});
