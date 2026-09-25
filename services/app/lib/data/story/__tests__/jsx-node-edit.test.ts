/**
 * ADDING AND REMOVING A NODE: `insertImageInJsx` (the editor's image drop) and
 * `removeJsxNodeAtPath` (its delete affordance). Both are total — a malformed
 * id, a stale path, a text-node path or unparseable source returns the source
 * untouched — and delete refuses to take the last top-level element, because a
 * document must keep a body.
 */
import { describe, it, expect } from 'vitest';

import {
  freshNodeId, imageAltInJsx, imageTargetInJsx, insertImageInJsx, nodeTargetInJsx, placeImageInJsx, removeJsxNodeAtPath, replaceImageSrcInJsx,
  setImageAltInJsx,
} from '@/lib/data/story/jsx-edit';
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

/**
 * REPLACING AN IMAGE swaps only the picture: the same node keeps its id (the
 * anchor its comments hang on), its position, its classes and its alt text.
 * The upload is async, so the node is found by its authored id first and by
 * path only when it has none — a stale target is refused, never guessed.
 */
describe('replaceImageSrcInJsx', () => {
  const SRC = '<div id="root" className="p-8"><p id="p1">intro</p>'
    + '<img id="img1" src="ref:Old111" alt="A chart" className="my-6 w-1/2 rounded-xl" /><p id="p2">after</p></div>';

  it('changes only src, keeping id, className, alt and position', () => {
    const out = replaceImageSrcInJsx(SRC, { path: '0.1' }, 'New222');
    expect(out).toBe(SRC.replace('ref:Old111', 'ref:New222'));
    expectValidStoryJsx(out);
  });

  it('finds the image by its id when the path has moved during the upload', () => {
    const moved = SRC.replace('<p id="p1">intro</p>', '<p id="p0">new first</p><p id="p1">intro</p>');
    const out = replaceImageSrcInJsx(moved, { path: '0.1', nodeId: 'img1' }, 'New222');
    expect(out).toBe(moved.replace('ref:Old111', 'ref:New222'));
  });

  it('refuses a target that is not a plain <img> — a stale path must not rewrite a neighbour', () => {
    expect(replaceImageSrcInJsx(SRC, { path: '0.0' }, 'New222')).toBe(SRC);
    expect(replaceImageSrcInJsx(SRC, { path: '0.9' }, 'New222')).toBe(SRC);
    expect(replaceImageSrcInJsx(SRC, { path: '0.1', nodeId: 'gone' }, 'New222')).toBe(SRC);
    expect(replaceImageSrcInJsx('<div><Question data="$q" /></div>', { path: '0.0' }, 'New222'))
      .toBe('<div><Question data="$q" /></div>');
  });

  it('refuses a malformed image id and unparseable source', () => {
    expect(replaceImageSrcInJsx(SRC, { path: '0.1' }, 'bad id!')).toBe(SRC);
    expect(replaceImageSrcInJsx('<div><img src="x"', { path: '0.0' }, 'New222')).toBe('<div><img src="x"');
  });

  it('replaces a URL src and drops a srcSet that would keep showing the old picture', () => {
    const src = '<div><img src="https://example.com/a.png" srcSet="https://example.com/a2.png 2x" sizes="100vw" alt="x" /></div>';
    const out = replaceImageSrcInJsx(src, { path: '0.0' }, 'New222');
    expect(out).toBe('<div><img src="ref:New222" alt="x" /></div>');
  });
});

describe('setImageAltInJsx', () => {
  const SRC = '<div><img id="i" src="ref:Old111" className="rounded" /></div>';

  it('adds, edits and removes the alt attribute', () => {
    const added = setImageAltInJsx(SRC, { path: '0.0' }, 'A red square');
    expect(added).toBe('<div><img id="i" src="ref:Old111" className="rounded" alt="A red square" /></div>');
    expectValidStoryJsx(added);
    const edited = setImageAltInJsx(added, { path: '0.0', nodeId: 'i' }, '  A blue square ');
    expect(edited).toContain('alt="A blue square"');
    expect(setImageAltInJsx(edited, { path: '0.0' }, '   ')).toBe(SRC);
  });

  it('escapes what the author typed rather than breaking the attribute', () => {
    const out = setImageAltInJsx(SRC, { path: '0.0' }, 'say "hi" <b>');
    expectValidStoryJsx(out);
    expect(parseJsx(out).ok).toBe(true);
  });

  it('refuses anything but a plain <img>', () => {
    expect(setImageAltInJsx('<div><p>x</p></div>', { path: '0.0' }, 'alt')).toBe('<div><p>x</p></div>');
  });
});

describe('imageTargetInJsx / imageAltInJsx — capturing the image an edit means', () => {
  it('captures the path and the authored id of a plain <img>, and reads its alt', () => {
    const src = '<div><p>x</p><img id="im" src="ref:Old111" alt="A chart" /><img src="ref:Old222" alt="" /></div>';
    expect(imageTargetInJsx(src, '0.1')).toEqual({ path: '0.1', nodeId: 'im' });
    expect(imageTargetInJsx(src, '0.2')).toEqual({ path: '0.2' });
    expect(imageAltInJsx(src, { path: '0.1' })).toBe('A chart');
    expect(imageAltInJsx(src, { path: '0.2' })).toBeNull(); // empty alt is no description
  });

  it('is null for anything that is not a plain <img>', () => {
    const src = '<div><p>x</p><Question data="$q" /></div>';
    expect(imageTargetInJsx(src, '0.0')).toBeNull();
    expect(imageTargetInJsx(src, '0.1')).toBeNull();
    expect(imageTargetInJsx(src, '0.7')).toBeNull();
    expect(imageTargetInJsx('<div><img', '0.0')).toBeNull();
  });
});

/**
 * WHERE AN INSERTED IMAGE GOES: at the node the person is on — the toolbar's
 * selection, the same node they see highlighted.
 *  - a text block (caret anywhere in it): directly below it, same container;
 *  - a container (card, card content, grid cell, section): inside, at the end;
 *  - a non-text leaf (chart, image, table): directly below it;
 *  - nothing: the end of the document — the only case that appends.
 * The result names the new image's path so the editor can select it.
 */
describe('placeImageInJsx', () => {
  const DOC = '<div className="p-8"><h1>T</h1><p>one</p><p>two <strong>bold</strong></p>'
    + '<Card><CardContent><p>in card</p></CardContent></Card>'
    + '<Grid mode="flow"><GridItem w={6}><p>cell</p></GridItem></Grid>'
    + '<ul><li>a</li><li>b</li></ul><table><tbody><tr><td>x</td></tr></tbody></table>'
    + '<Question data="$q" /><img src="ref:Old111" alt="o" /><section><p>s</p></section></div>';
  const IMG = '<img src="ref:New222" alt="" className="my-6 block w-full rounded-md" />';
  const place = (anchor?: Parameters<typeof placeImageInJsx>[2]) => placeImageInJsx(DOC, 'New222', anchor);
  const at = (out: { source: string; path: string | null }, before: string) => {
    expect(out.source).toContain(`${before}${IMG}`);
    expectValidStoryJsx(out.source);
  };

  it('a text block: directly below it', () => {
    const out = place({ path: '0.1' });
    at(out, '<p>one</p>');
    expect(out.path).toBe('0.2');
    at(place({ path: '0.0' }), '<h1>T</h1>');
  });

  it('an inline part of a paragraph: below the paragraph, never inside it', () => {
    const out = place({ path: '0.2.1' }); // <strong>
    at(out, '<p>two <strong>bold</strong></p>');
    expect(out.path).toBe('0.3');
  });

  it('a text block inside a card: below it, still inside the card', () => {
    const out = place({ path: '0.3.0.0' });
    at(out, '<p>in card</p>');
    expect(out.path).toBe('0.3.0.1');
  });

  it('a container — card, card content, grid cell, section — takes it inside, at the end', () => {
    expect(place({ path: '0.3' }).source).toContain(`</CardContent>${IMG}</Card>`);
    expect(place({ path: '0.3.0' }).source).toContain(`<p>in card</p>${IMG}</CardContent>`);
    expect(place({ path: '0.4.0' }).source).toContain(`<p>cell</p>${IMG}</GridItem>`);
    const section = place({ path: '0.9' });
    expect(section.source).toContain(`<p>s</p>${IMG}</section>`);
    expect(section.path).toBe('0.9.1');
  });

  it('the grid itself is a leaf: below it, never loose among its cells', () => {
    at(place({ path: '0.4' }), '</Grid>');
  });

  it('a list item or a table cell: below the whole list or table', () => {
    at(place({ path: '0.5.1' }), '</ul>');
    at(place({ path: '0.6.0.0.0' }), '</table>');
  });

  it('a non-text leaf — a chart, an image: directly below it', () => {
    at(place({ path: '0.7' }), '<Question data="$q" />');
    at(place({ path: '0.8' }), '<img src="ref:Old111" alt="o" />');
  });

  it('nothing selected, or a target that is gone: the end of the document', () => {
    for (const out of [place(), place({ path: '0.99' }), place({ path: '0.1', nodeId: 'gone' })]) {
      expect(out.source).toContain(`<section><p>s</p></section>${IMG}</div>`);
      expect(out.path).toBe('0.10');
    }
  });

  it('follows the authored id when the path moved while the upload ran', () => {
    const src = '<div><p id="a">a</p><p id="b">b</p></div>';
    const moved = '<div><p id="z">new</p><p id="a">a</p><p id="b">b</p></div>';
    expect(nodeTargetInJsx(src, '0.0')).toEqual({ path: '0.0', nodeId: 'a' });
    const out = placeImageInJsx(moved, 'New222', { path: '0.0', nodeId: 'a' });
    expect(out.source).toContain(`<p id="a">a</p>${IMG}<p id="b">`);
    expect(out.path).toBe('0.2');
  });

  it('an explicit side from a drop: before, after or inside', () => {
    expect(place({ path: '0.1', side: 'before' }).source).toContain(`<h1>T</h1>${IMG}<p>one</p>`);
    at(place({ path: '0.1', side: 'after' }), '<p>one</p>');
    expect(place({ path: '0.3.0', side: 'inside' }).source).toContain(`<p>in card</p>${IMG}</CardContent>`);
    // A grid cell's gap is its inside: an image is never a loose child of <Grid>.
    expect(place({ path: '0.4.0', side: 'before' }).source).toContain(`<GridItem w={6}><p>cell</p>${IMG}</GridItem>`);
  });

  it('insertImageInJsx still appends when given no anchor, and takes one when given', () => {
    expect(insertImageInJsx(DOC, 'New222')).toBe(place().source);
    expect(insertImageInJsx(DOC, 'New222', { path: '0.1' })).toBe(place({ path: '0.1' }).source);
  });
});

/**
 * An inserted image carries its node id FROM THE START. Left to the server,
 * the id arrives in the save's echo as a change inside the very span undo
 * would remove — and undo refused the insert as "changed elsewhere".
 */
describe('an inserted image\'s id', () => {
  it('is written with the image when given', () => {
    const out = placeImageInJsx('<div><p id="a">a</p></div>', 'New222', { path: '0.0' }, { nodeId: 'Qx7k' });
    expect(out.source).toBe('<div><p id="a">a</p><img src="ref:New222" alt="" className="my-6 block w-full rounded-md" id="Qx7k" /></div>');
  });

  it('is minted in the server\'s shape, never one the document already uses', () => {
    const taken = ['Aaaa', 'Bbbb'];
    const picks = ['Aaaa', 'Bbbb', 'Cc12'];
    const id = freshNodeId(`<div id="Aaaa"><p id="Bbbb">x</p></div>`, () => picks.shift()!);
    expect(id).toBe('Cc12');
    expect(taken).not.toContain(id);
    expect(freshNodeId('<div />')).toMatch(/^[A-Za-z][A-Za-z0-9]{3}$/);
  });
});
