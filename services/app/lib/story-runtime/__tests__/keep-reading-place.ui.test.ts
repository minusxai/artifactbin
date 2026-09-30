/**
 * ENTERING EDIT MUST NOT MOVE THE PAGE. The edit bar reserves its height on the story host; the
 * reader's paragraph stays where it was on screen, in the same task as the change.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepReadingPlace } from '@/lib/story-runtime/anchor';

let padding = 0;
let scroll = 0;
const paragraphs: HTMLElement[] = [];

function mount() {
  document.body.innerHTML = '';
  for (let index = 0; index < 20; index++) {
    const p = document.createElement('p');
    p.setAttribute('data-mx-ast', `0.${index}`);
    // 100px paragraphs under the host's reserved padding, in viewport coordinates.
    p.getBoundingClientRect = () => ({ top: padding + index * 100 - scroll, height: 100, width: 600, bottom: padding + index * 100 - scroll + 100, left: 0, right: 600, x: 0, y: padding + index * 100 - scroll, toJSON: () => ({}) }) as DOMRect;
    document.body.append(p);
    paragraphs.push(p);
  }
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scroll });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  window.scrollTo = vi.fn((options?: ScrollToOptions | number) => { scroll = typeof options === 'number' ? options : options?.top ?? scroll; }) as typeof window.scrollTo;
}

afterEach(() => { padding = 0; scroll = 0; paragraphs.length = 0; });

describe('keepReadingPlace', () => {
  it('keeps the paragraph under the reader at the same viewport position when the bar reserves its height', () => {
    mount();
    scroll = 1030;
    const before = paragraphs[14]!.getBoundingClientRect().top;
    keepReadingPlace(window, () => { padding += 44; });
    expect(paragraphs[14]!.getBoundingClientRect().top).toBe(before);
    expect(scroll).toBe(1074);
  });

  it('and back again when the bar goes', () => {
    mount();
    padding = 44;
    scroll = 1074;
    const before = paragraphs[14]!.getBoundingClientRect().top;
    keepReadingPlace(window, () => { padding -= 44; });
    expect(paragraphs[14]!.getBoundingClientRect().top).toBe(before);
  });

  it('leaves a reader at the very top alone: the document moves down by the bar, its first line stays visible', () => {
    mount();
    const change = vi.fn(() => { padding += 44; });
    keepReadingPlace(window, change);
    expect(change).toHaveBeenCalledOnce();
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(scroll).toBe(0);
  });
});
