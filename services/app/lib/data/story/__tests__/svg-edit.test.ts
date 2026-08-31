/**
 * SVG subset — editor atomicity. SVG internals are drawing, not prose:
 * contenteditable inside an <svg> subtree is undefined behavior in browsers
 * and its write-back would splice drawing coordinates as text. The text-host
 * predicate must never claim an svg element, whatever text it carries.
 */
import { describe, it, expect } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import type { JsxElement } from '@/lib/jsx/types';
import { isEditableTextHost } from '../jsx-edit';

const elementAt = (src: string, path: number[]): JsxElement => {
  const parsed = parseJsx(src);
  if (!parsed.ok) throw new Error(parsed.error);
  let nodes = parsed.nodes;
  let el: JsxElement | null = null;
  for (const idx of path) {
    const n = nodes[idx];
    if (n.type !== 'element') throw new Error('not an element');
    el = n;
    nodes = n.children;
  }
  return el!;
};

describe('svg is atomic in the editor', () => {
  it('svg <text> with direct text is NOT a text host', () => {
    const text = elementAt('<svg><text x="0" y="10">label</text></svg>', [0, 0]);
    expect(isEditableTextHost(text)).toBe(false);
  });

  it('svg <title>/<desc> are NOT text hosts', () => {
    const title = elementAt('<svg><title>a11y name</title></svg>', [0, 0]);
    expect(isEditableTextHost(title)).toBe(false);
  });

  it('an ordinary <p> beside the svg still is a text host', () => {
    const p = elementAt('<div><p>prose</p></div>', [0, 0]);
    expect(isEditableTextHost(p)).toBe(true);
  });
});
