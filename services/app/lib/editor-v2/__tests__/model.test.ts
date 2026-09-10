import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { splitBlock } from 'prosemirror-commands';
import { validateJsx } from '@/lib/jsx/validate';
import { parseJsx, serializeJsx } from '@/lib/jsx';
import {
  editorDocument,
  sourceNodes,
  normalizeIdentities,
  pasteFragment,
  replaceColumnText,
  toggleInline,
} from '../model';
import { clipboardAst } from '../clipboard';

function state(source: string) {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
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
  it('cross-column replacement keeps both containers and one empty paragraph', () => {
    let s = state(
      '<GridItem id="left"><p id="a">alpha</p></GridItem><GridItem id="right"><p id="b">bravo</p></GridItem>',
    );
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 4, 16)));
    s = s.apply(replaceColumnText(s, 'X'));
    expect(source(s)).toBe(
      '<GridItem id="left"><p id="a">alX</p></GridItem><GridItem id="right"><p id="b"></p></GridItem>',
    );
    expect(s.selection.from).toBe(5);
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
  const parsed = parseJsx('<Grid mode="flow"><GridItem w={6} h={2} x={0}><p>text</p></GridItem></Grid>');
  if (!parsed.ok) throw Error(parsed.error);
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
