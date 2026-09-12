/**
 * ADDING AND REMOVING A NODE: `insertImageInJsx` (the editor's image drop) and
 * `removeJsxNodeAtPath` (its delete affordance). Both are total — a malformed
 * id, a stale path, a text-node path or unparseable source returns the source
 * untouched — and delete refuses to take the last top-level element, because a
 * document must keep a body.
 */
import { describe, it, expect } from 'vitest';

import { insertImageInJsx, removeJsxNodeAtPath } from '@/lib/data/story/jsx-edit';
import { parseJsx } from '@/lib/jsx';
import { expectValidStoryJsx } from '@/test/helpers/jsx';

describe('insertImageInJsx', () => {
  it('appends an <img ref:> inside the top-level container and stays valid story JSX', () => {
    const src = '<div data-design="tw" className="p-8"><h1 className="text-2xl">Title</h1></div>';
    const out = insertImageInJsx(src, 'Ab12Cd');
    expect(out).toContain('src="ref:Ab12Cd"');
    // Inside the container (before its close), not a stray top-level sibling.
    expect(out).toMatch(/<img[^>]*ref:Ab12Cd[^>]*\/>\s*<\/div>/);
    expectValidStoryJsx(out);
  });

  it('appends at the top level when the body has no container element', () => {
    const out = insertImageInJsx('Just text', 'Zz99Yy');
    expect(out).toContain('src="ref:Zz99Yy"');
    expectValidStoryJsx(out);
  });

  it('round-trips: the inserted body re-parses unchanged', () => {
    const src = '<div className="p-4"><p>hi</p></div>';
    const out = insertImageInJsx(src, 'Q1w2E3');
    expect(parseJsx(out).ok).toBe(true);
  });

  it('leaves the body untouched for a malformed image id', () => {
    const src = '<div className="p-4"><p>hi</p></div>';
    expect(insertImageInJsx(src, 'bad id!')).toBe(src);
    expect(insertImageInJsx(src, 'short')).toBe(src);
  });

  it('leaves the body untouched when the source does not parse', () => {
    const src = '<div className="p-4"><p>oops';
    expect(insertImageInJsx(src, 'Ab12Cd')).toBe(src);
  });
});

describe('removeJsxNodeAtPath — element deletion (the editor\'s delete affordance)', () => {
  it('removes a nested plain element', () => {
    const src = '<div className="p-4"><p>keep</p><p>drop</p></div>';
    const out = removeJsxNodeAtPath(src, '0.1');
    expect(out).toBe('<div className="p-4"><p>keep</p></div>');
    expectValidStoryJsx(out);
  });

  it('removes a component embed (a <Question>) — siblings keep their content', () => {
    const src = '<div className="p-4"><h1>Report</h1><Question title="Rev" data="ref:dsSale1" /><p>after</p></div>';
    const out = removeJsxNodeAtPath(src, '0.1');
    expect(out).not.toContain('Question');
    expect(out).toContain('<h1>Report</h1>');
    expect(out).toContain('<p>after</p>');
    expectValidStoryJsx(out);
  });

  it('removes one of several top-level elements', () => {
    const src = '<div><p>a</p></div><div><p>b</p></div>';
    const out = removeJsxNodeAtPath(src, '1');
    expect(out).toBe('<div><p>a</p></div>');
    expectValidStoryJsx(out);
  });

  it('refuses to remove the LAST top-level element — a document must keep a body', () => {
    const src = '<div className="p-4"><p>everything</p></div>';
    expect(removeJsxNodeAtPath(src, '0')).toBe(src);
  });

  it('a stale/unresolvable path leaves the source untouched', () => {
    const src = '<div><p>x</p></div>';
    expect(removeJsxNodeAtPath(src, '9.9')).toBe(src);
    expect(removeJsxNodeAtPath(src, '0.5')).toBe(src);
    expect(removeJsxNodeAtPath(src, 'evil')).toBe(src);
    expect(removeJsxNodeAtPath(src, '')).toBe(src);
  });

  it('only elements are deletable — a text-node path is refused', () => {
    const src = '<div><p>some text</p></div>';
    // 0.0.0 is the text node inside the <p>.
    expect(removeJsxNodeAtPath(src, '0.0.0')).toBe(src);
  });

  it('returns unparseable source unchanged (never throws)', () => {
    const src = '<div><p>broken';
    expect(removeJsxNodeAtPath(src, '0.0')).toBe(src);
  });

  it('a deep delete keeps the rest of the tree byte-identical', () => {
    const src = '<div className="p-8"><section><h2 className="text-xl">A</h2><ul><li>one</li><li>two</li></ul></section></div>';
    const out = removeJsxNodeAtPath(src, '0.0.1.0'); // the first <li>
    expect(out).toBe('<div className="p-8"><section><h2 className="text-xl">A</h2><ul><li>two</li></ul></section></div>');
    expectValidStoryJsx(out);
  });
});
