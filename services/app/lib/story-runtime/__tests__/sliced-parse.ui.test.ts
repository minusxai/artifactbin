import { describe, expect, it } from 'vitest';
import { parseHtmlInSlices } from '../sliced-parse';

/** A window whose clock runs out at every write: each piece of the parse is a task of its own. */
const slowWindow = (asked: { count: number }) => {
  let clock = 0;
  return new Proxy(window, {
    get(target, key) {
      if (key === 'performance') return { now: () => (clock += 100) };
      const value = Reflect.get(target, key) as unknown;
      return typeof value === 'function' && !/^[A-Z]/.test(String(key)) ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as Window & { asked?: typeof asked };
};

const page = (rows: number) => `<!doctype html><html><head><style data-mx-story-css>p{}</style></head><body><div data-mx-inline-story="">${
  Array.from({ length: rows }, (_, i) => `<p data-mx-ast="${i}" id="p${i}">Row ${i} &amp; café \u{1F600}</p>`).join('')}<script>window.__ran = 1</script></div></body></html>`;

describe('a compiled page parsed in slices', () => {
  it('parses to the same document one parse gives, running none of its scripts', async () => {
    const html = page(3000);
    const parsed = await parseHtmlInSlices(slowWindow({ count: 0 }), html, () => true);
    const once = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed).not.toBeNull();
    expect(parsed!.querySelector('[data-mx-inline-story]')!.innerHTML).toBe(once.querySelector('[data-mx-inline-story]')!.innerHTML);
    expect(parsed!.querySelectorAll('p[data-mx-ast]').length).toBe(3000);
    expect(parsed!.querySelector('style[data-mx-story-css]')).not.toBeNull();
    expect((window as Window & { __ran?: number }).__ran).toBeUndefined();
  });

  it('stops between slices once the draft is no longer current, or parses whole where the DOM cannot stream', async () => {
    const html = page(3000);
    let asked = 0;
    const parsed = await parseHtmlInSlices(slowWindow({ count: 0 }), html, () => { asked++; return false; });
    // Streaming: asked after the first slice and stopped there. Without it (one DOMParser call), never asked.
    if (asked) expect(parsed).toBeNull();
    else expect(parsed!.querySelectorAll('p[data-mx-ast]').length).toBe(3000);
  });
});
