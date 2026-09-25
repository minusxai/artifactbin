/**
 * ADDING AND REMOVING A NODE: `insertImageInJsx` (the editor's image drop) and
 * `removeJsxNodeAtPath` (its delete affordance). Both are total — a malformed
 * id, a stale path, a text-node path or unparseable source returns the source
 * untouched — and delete refuses to take the last top-level element, because a
 * document must keep a body.
 */
import { describe, it, expect } from 'vitest';

import {
  imageAltInJsx, imageTargetInJsx, insertImageInJsx, removeJsxNodeAtPath, replaceImageSrcInJsx, setImageAltInJsx,
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
