/**
 * B1 — WHAT THE FRAME TELLS THE PAGE ABOUT THE READER'S SCROLL.
 *
 * A framed document is opaque: the page hosting it cannot read its offsets,
 * its height, or anything else about it, so the only thing the phone bar can
 * act on is what the document says. It said one number — its offset — and the
 * page compared that against its OWN metrics to decide "is the reader at the
 * end of the page", which for a framed document is always the wrong answer
 * (the parent never scrolls). So the end-of-page rule, the one that keeps the
 * bar off the footer, was lost for every framed document.
 *
 * The sample now carries the answer instead of the ingredients: the document
 * measures its own end, with the same 4px slack the page uses for its own.
 *
 * In jsdom `window.parent === window`, so the module reads as top-level and
 * posts nothing. Faking the parent BEFORE the import is the whole setup —
 * these are module-eval side effects, so import order is the arrangement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_SCROLL_MESSAGE } from '@/lib/story-runtime/contract';

const set = (target: object, key: string, value: unknown) =>
  Object.defineProperty(target, key, { configurable: true, value });

/** A framed window whose document is `scrollHeight` tall, scrolled to `scrollY`. */
const framed = (scrollY: number, scrollHeight: number) => {
  const posts: unknown[] = [];
  set(window, 'parent', { postMessage: (message: unknown) => { posts.push(message); } });
  set(window, 'scrollY', scrollY);
  set(window, 'innerHeight', 800);
  set(document.documentElement, 'scrollHeight', scrollHeight);
  // A 15px scrollbar: the sample carries the gutter so page chrome over the
  // frame can end where the document's own bar does.
  set(window, 'innerWidth', 1000);
  set(document.documentElement, 'clientWidth', 985);
  // The module batches samples into one animation frame; run it inline so the
  // assertion is about the message and not about jsdom's timer.
  set(window, 'requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  return posts;
};

beforeEach(() => vi.resetModules());
afterEach(() => set(window, 'parent', window));

describe('the framed scroll sample', () => {
  it('carries the offset and says the document is not at its end', async () => {
    const posts = framed(500, 4000);
    await import('@/lib/story-runtime/anchor-entry');
    expect(posts.at(-1)).toEqual({ type: STORY_SCROLL_MESSAGE, scrollY: 500, atBottom: false, gutter: 15 });
  });

  it('says the document IS at its end, with the same 4px slack the page uses', async () => {
    // 3196 + 800 = 3996, which is 4000 - 4: the last scrollable pixel.
    const posts = framed(3196, 4000);
    await import('@/lib/story-runtime/anchor-entry');
    expect(posts.at(-1)).toEqual({ type: STORY_SCROLL_MESSAGE, scrollY: 3196, atBottom: true, gutter: 15 });
  });

  it('samples once at load and again on every scroll', async () => {
    const posts = framed(0, 4000);
    await import('@/lib/story-runtime/anchor-entry');
    expect(posts).toHaveLength(1);
    set(window, 'scrollY', 900);
    window.dispatchEvent(new Event('scroll'));
    expect(posts.at(-1)).toEqual({ type: STORY_SCROLL_MESSAGE, scrollY: 900, atBottom: false, gutter: 15 });
    expect(posts).toHaveLength(2);
  });
});
