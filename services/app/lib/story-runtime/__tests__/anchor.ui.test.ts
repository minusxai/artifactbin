import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAnchor, currentAnchor } from '@/lib/story-runtime/anchor';

let scroll = 0;
function mount(heights: number[], hidden: number[] = []) {
  document.body.innerHTML = '';
  let top = 0;
  heights.forEach((height, index) => {
    const p = document.createElement('p');
    p.setAttribute('data-mx-ast', `0.${index}`);
    const at = top;
    const empty = hidden.includes(index);
    p.getBoundingClientRect = () => ({ top: at - scroll, height: empty ? 0 : height, width: empty ? 0 : 600 }) as DOMRect;
    document.body.append(p);
    top += empty ? 0 : height;
  });
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scroll });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  window.scrollTo = vi.fn((options?: ScrollToOptions | number) => { scroll = typeof options === 'number' ? options : options?.top ?? scroll; }) as typeof window.scrollTo;
}
afterEach(() => { scroll = 0; document.body.innerHTML = ''; });

describe('currentAnchor', () => {
  it('names the element at the top of the reader’s view and how far into it they are', () => {
    mount([100, 100, 100, 100]);
    scroll = 150;
    expect(currentAnchor(window)).toEqual({ path: '0.1', fraction: 0.5 });
  });

  it('is null for a document with nothing measurable in it, and skips elements without a box', () => {
    mount([]);
    expect(currentAnchor(window)).toBeNull();
    mount([100, 100], [0]);
    expect(currentAnchor(window)?.path).toBe('0.1');
  });
});

describe('applyAnchor', () => {
  it('scrolls back to the anchored place and answers the target it asked for', () => {
    mount([100, 100, 100, 100]);
    expect(applyAnchor(window, { path: '0.2', fraction: 0.25 })).toBe(225);
    expect(scroll).toBe(225);
  });

  it('leaves the position alone when the anchored element is gone, and clamps a bad fraction', () => {
    mount([100, 100]);
    scroll = 40;
    expect(applyAnchor(window, { path: '9.9', fraction: 0 })).toBeNull();
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(applyAnchor(window, { path: '0.1', fraction: 7 })).toBe(200);
    expect(applyAnchor(window, { path: '0.1', fraction: Number.NaN })).toBe(100);
  });
});
