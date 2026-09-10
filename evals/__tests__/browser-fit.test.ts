// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'playwright';
import { inspectDocument } from '../lib/score/browser';

// jsdom has no layout engine. Supply the measured browser geometry from the
// 390px plan regression, while exercising the inspector's real DOM measurement.
function fixture(surfaceWidth: number, surfaceScrollWidth: number, nestedScrollWidth = surfaceWidth) {
  document.body.innerHTML = '<div class="mx-doc" style="overflow-x:clip"><div style="overflow-x:auto"></div></div>';
  const surface = document.querySelector('.mx-doc')!;
  const dimensions = (element: Element, width: number, scroll: number) => {
    Object.defineProperties(element, {
      clientWidth: { configurable: true, value: width },
      scrollWidth: { configurable: true, value: scroll },
    });
  };
  dimensions(document.documentElement, 390, 390);
  dimensions(surface, surfaceWidth, surfaceScrollWidth);
  dimensions(surface.firstElementChild!, surfaceWidth, nestedScrollWidth);
  vi.stubGlobal('innerWidth', 390);
  const page = {
    on: vi.fn(), goto: vi.fn(), waitForTimeout: vi.fn(), close: vi.fn(),
    evaluate: async (fn: () => unknown) => fn(),
  };
  return { newPage: async () => page } as unknown as Browser;
}

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('mobile document fit', () => {
  it('rejects content clipped by the document surface even when the page width fits', async () => {
    const result = await inspectDocument(fixture(390, 594), 'http://example.test/plan', 390);
    expect(result.scrollWidth).toBe(390);
    expect(result.fits).toBe(false);
  });

  it('allows a wide diagram inside a bounded horizontal scroller', async () => {
    expect((await inspectDocument(fixture(390, 390, 760), 'http://example.test/plan', 390)).fits).toBe(true);
  });
});
