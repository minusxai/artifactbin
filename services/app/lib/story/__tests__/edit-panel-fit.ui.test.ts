/**
 * Does the edit panel fit in the document's own margin? Measured once, as
 * edit mode opens: a yes lets the panel sit over empty margin with the document
 * unmoved, a no reserves its width. Covering a chart is the failure, so ink
 * counts and doubt answers no. jsdom lays nothing out, so each case gives its
 * elements the boxes a 1440px window would.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentInkRight, panelFitsInMargin } from '@/lib/story/edit-panel-fit';

const box = (el: Element, left: number, width: number, top = 0, height = 40) =>
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(left, top, width, height));

function page(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the edit panel fit', () => {
  it('a centred prose column at 1440px leaves the panel room: it fits', () => {
    const root = page('<main><article><h1>Title</h1><p>Body text</p></article></main>');
    box(root.querySelector('main')!, 0, 1425, 0, 2000);
    box(root.querySelector('article')!, 328, 768, 0, 2000);
    box(root.querySelector('h1')!, 352, 720);
    box(root.querySelector('p')!, 352, 720);
    expect(documentInkRight(root, 1425)).toBe(1072);
    expect(panelFitsInMargin(root, 1425, 320)).toBe(true);
    // The same column at a laptop width does not.
    expect(panelFitsInMargin(root, 1200, 320)).toBe(false);
  });

  it('a full-bleed chart is ink right to the edge: it does not fit', () => {
    const root = page('<main><p>Intro</p><figure><svg></svg></figure></main>');
    box(root.querySelector('main')!, 0, 1425, 0, 2000);
    box(root.querySelector('p')!, 352, 720);
    box(root.querySelector('figure')!, 0, 1425, 100, 400);
    box(root.querySelector('svg')!, 0, 1425, 100, 400);
    expect(panelFitsInMargin(root, 1425, 320)).toBe(false);
  });

  it('a full-width band only paints the ground; the text inside it is what counts', () => {
    const root = page('<section style="background-color: rgb(10, 20, 30)"><h2>Band</h2></section>');
    box(root.querySelector('section')!, 0, 1425, 0, 300);
    box(root.querySelector('h2')!, 352, 720);
    expect(panelFitsInMargin(root, 1425, 320)).toBe(true);
  });

  it('a boxed card near the edge is ink even with no text of its own', () => {
    const root = page('<div><p>Text</p><div class="card" style="border: 1px solid rgb(0, 0, 0)"><span></span></div></div>');
    box(root.firstElementChild!, 0, 1425, 0, 2000);
    box(root.querySelector('p')!, 352, 720);
    box(root.querySelector('.card')!, 900, 400, 100, 200);
    expect(documentInkRight(root, 1425)).toBe(1300);
    expect(panelFitsInMargin(root, 1425, 320)).toBe(false);
  });

  it('what is not displayed draws nothing', () => {
    const root = page('<p>Text</p><div style="display: none"><p>Hidden wide text</p></div>');
    box(root.querySelector('p')!, 352, 720);
    expect(panelFitsInMargin(root, 1425, 320)).toBe(true);
  });
});
