/**
 * The outline's BEHAVIOUR, which lives outside React on purpose: a document of
 * prose ships no runtime, so a click on a rail row has to work with plain DOM
 * or it does not work at all (the first browser gate found exactly that).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wireOutline } from '@/lib/islands/outline-nav';

function build() {
  doc.body.innerHTML = `
    <div class="mx-reading">
      <nav class="mx-outline" aria-label="Contents">
        <button class="mx-outline-row" data-mx-target="0.0">A</button>
        <button class="mx-outline-row" data-mx-target="0.1">B</button>
        <button class="mx-outline-row" data-mx-target="0.2">C</button>
      </nav>
      <div class="mx-doc"><article data-mx-ast="0">
        <h2 data-mx-ast="0.0">A</h2><h2 data-mx-ast="0.1">B</h2><h2 data-mx-ast="0.2">C</h2>
      </article></div>
    </div>`;
  const headings = [...doc.querySelectorAll<HTMLElement>('.mx-doc h2')];
  const rows = [...doc.querySelectorAll<HTMLElement>('.mx-outline-row')];
  return { headings, rows };
}
/**
 * Each case wires a document of its own (an iframe's): the shared islands jsdom keeps lib/islands/page's module-level
 * wiring on the top document, and that listener would answer this file's events too.
 */
let doc: Document;
beforeEach(() => { const frame = document.createElement('iframe'); document.body.appendChild(frame); doc = frame.contentDocument!; });
let stop: (() => void) | null = null;
afterEach(() => { stop?.(); stop = null; document.body.innerHTML = ''; });

describe('wireOutline', () => {
  it('a click on a row scrolls its heading — and only its heading — into view', () => {
    const { headings, rows } = build();
    const spies = headings.map((h) => { const s = vi.fn(); h.scrollIntoView = s; return s; });
    stop = wireOutline(doc);
    rows[2].click();
    expect(spies.map((s) => s.mock.calls.length)).toEqual([0, 0, 1]);
  });

  it('marks the row whose heading was last crossed as the reader scrolls', () => {
    const { headings, rows } = build();
    headings.forEach((h, i) => { h.getBoundingClientRect = () => ({ top: i < 2 ? -10 : 900 } as DOMRect); });
    stop = wireOutline(doc);
    doc.defaultView!.dispatchEvent(new Event('scroll'));
    expect(rows.map((r) => r.getAttribute('aria-current'))).toEqual([null, 'true', null]);
    headings.forEach((h) => { h.getBoundingClientRect = () => ({ top: -10 } as DOMRect); });
    doc.defaultView!.dispatchEvent(new Event('scroll'));
    expect(rows.map((r) => r.getAttribute('aria-current'))).toEqual([null, null, 'true']);
  });

  it('wires an outline that ARRIVES LATER — a live update can turn a page into a sectioned document', async () => {
    doc.body.innerHTML = '<div class="mx-reading"><div class="mx-doc"><article data-mx-ast="0"></article></div></div>';
    stop = wireOutline(doc);
    doc.querySelector('.mx-reading')!.insertAdjacentHTML('afterbegin',
      '<nav class="mx-outline" aria-label="Contents"><button class="mx-outline-row" data-mx-target="0.0">A</button></nav>');
    doc.querySelector('.mx-doc article')!.innerHTML = '<h2 data-mx-ast="0.0">A</h2>';
    await new Promise((r) => setTimeout(r, 40));
    const heading = doc.querySelector<HTMLElement>('.mx-doc h2')!;
    const spy = vi.fn();
    heading.scrollIntoView = spy;
    doc.querySelector<HTMLElement>('.mx-outline-row')!.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('re-marks after a live update rebuilds the rows', async () => {
    const { headings } = build();
    headings.forEach((h) => { h.getBoundingClientRect = () => ({ top: -10 } as DOMRect); });
    stop = wireOutline(doc);
    const rail = doc.querySelector('.mx-outline')!;
    rail.innerHTML = '<button class="mx-outline-row" data-mx-target="0.0">A</button><button class="mx-outline-row" data-mx-target="0.1">B</button>';
    await new Promise((r) => setTimeout(r, 40));
    const rows = [...doc.querySelectorAll('.mx-outline-row')];
    expect(rows.map((r) => r.getAttribute('aria-current'))).toEqual([null, 'true']);
  });

  it('disposes cleanly, and stops responding once disposed', () => {
    const { headings, rows } = build();
    const spy = vi.fn();
    headings[0].scrollIntoView = spy;
    const off = wireOutline(doc);
    expect(() => off()).not.toThrow();
    rows[0].click();
    expect(spy).not.toHaveBeenCalled();
  });
});
