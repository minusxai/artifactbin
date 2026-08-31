/**
 * describeSelection — the parent has no element, only this.
 *
 * Everything the toolbar, the chart panel and the breadcrumb need has to
 * survive a postMessage, so anything missing here is chrome that cannot be
 * drawn. A stale path must describe NOTHING rather than something: the parent
 * would otherwise act on whichever node now sits at that position.
 */
import { describe, it, expect } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { describeSelection, selectionKindAt, ancestorCrumbs } from '../describe-selection';

const SRC = '<div className="p-8 max-w-2xl"><h1 className="text-3xl">Title</h1>'
  + '<div className="flex gap-2"><p className="lede" style="color: red">hello world</p></div>'
  + '<Question data="$q" /><div className="empty"></div></div>';
const nodes = (() => { const p = parseJsx(SRC); if (!p.ok) throw new Error('fixture does not parse'); return p.nodes; })();

/** Render the fixture's shape with AST stamps, the way the interpreter does. */
function mount() {
  document.body.innerHTML = `
    <div data-mx-ast="0" class="p-8 max-w-2xl">
      <h1 data-mx-ast="0.0" class="text-3xl">Title</h1>
      <div data-mx-ast="0.1" class="flex gap-2">
        <p data-mx-ast="0.1.0" class="lede" style="color: red">hello world</p>
      </div>
      <div data-mx-ast="0.2" aria-label="Question embed"></div>
      <div data-mx-ast="0.3" class="empty"></div>
    </div>`;
  return (path: string) => document.querySelector(`[data-mx-ast="${path}"]`)!;
}

describe('selectionKindAt', () => {
  it('classifies by the SOURCE, not the DOM', () => {
    expect(selectionKindAt(nodes, '0.0')).toBe('text');      // h1 with text
    expect(selectionKindAt(nodes, '0.1.0')).toBe('text');    // p with text
    expect(selectionKindAt(nodes, '0.1')).toBe('element');   // container
    expect(selectionKindAt(nodes, '0.2')).toBe('embed');     // component
    expect(selectionKindAt(nodes, '0.3')).toBe('element');   // empty div: no text, not a host
  });

  it('is null for a path the source does not have', () => {
    expect(selectionKindAt(nodes, '9.9')).toBeNull();
    expect(selectionKindAt(nodes, '')).toBeNull();
    expect(selectionKindAt(nodes, 'not.a.path')).toBeNull();
  });
});

describe('describeSelection', () => {
  it('carries everything the parent chrome needs', () => {
    const at = mount();
    const sel = describeSelection(at('0.1.0'), nodes)!;
    expect(sel).toMatchObject({ kind: 'text', path: '0.1.0', tag: 'p', className: 'lede', style: 'color: red' });
    expect(sel.rect).toEqual({
      x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number),
    });
  });

  it('reports the ancestor chain OUTERMOST first, skipping hosts, components and the ROOT', () => {
    // The root is never a breadcrumb destination — selecting the element that
    // wraps the whole document is not an edit anyone means to make. Ported
    // rule (the canvas's isSelectableFormatTarget: `path.includes('.')`).
    const at = mount();
    const sel = describeSelection(at('0.1.0'), nodes)!;
    expect(sel.ancestors.map((a) => a.path)).toEqual(['0.1']);
    expect(sel.ancestors.map((a) => a.hint)).toEqual(['flex']);
  });

  it('describes a component as an embed', () => {
    const at = mount();
    expect(describeSelection(at('0.2'), nodes)).toMatchObject({ kind: 'embed', tag: 'Question' });
  });

  it('describes NOTHING for a stale path — the parent must not act on a moved node', () => {
    const at = mount();
    const el = at('0.1.0');
    el.setAttribute('data-mx-ast', '7.7');
    expect(describeSelection(el, nodes)).toBeNull();
  });

  it('describes nothing for an element with no AST stamp (a rail preview, chrome)', () => {
    document.body.innerHTML = '<div class="mx-rail"><p>preview copy</p></div>';
    expect(describeSelection(document.querySelector('p')!, nodes)).toBeNull();
  });

  it('reports missing class/style as empty strings, never undefined', () => {
    const at = mount();
    const sel = describeSelection(at('0.0'), nodes)!;
    expect(sel.style).toBe('');
    expect(sel.className).toBe('text-3xl');
  });
});

describe('ancestorCrumbs', () => {
  it('is empty at the root', () => {
    const at = mount();
    expect(ancestorCrumbs(at('0'), nodes)).toEqual([]);
  });
});
