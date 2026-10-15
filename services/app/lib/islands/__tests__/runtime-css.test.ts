/**
 * A CLASS THE PAGE'S DATA BRINGS (lib/islands/runtime-css): hidden in the same task the element gets it, asked for
 * once per burst at the version's door, and the answer — the document's WHOLE sheet — replaces the page's Tailwind in
 * all its parts where it stood, ahead of the sheets that follow it. A page whose classes are all known never asks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noteClasses, RUNTIME_PENDING_ATTR, startRuntimeCss, swapTailwindSheet } from '../runtime-css';
import { rowClass } from '../row-class';
import { boot } from '../boot';
import { STORY_VERSION_DRAWN_EVENT } from '@/lib/story-runtime/contract';

const DATA = { url: '/a/doc1/css?v=1&k=v1', known: ['px-2', '{$_row.cls}'], extras: ['bg-red-500'] };

function head() {
  document.head.innerHTML = '<style data-mx-tw-s0>.s0{}</style><link rel="stylesheet" href="/islands/c/s1.css" data-mx-tw-s1>'
    + '<style data-mx-tw-i0>.bg-red-500{}</style><link rel="stylesheet" href="/islands/c/base.css" data-mx-base><style data-mx-author>.mine{}</style>';
}
const order = () => [...document.head.children].map((el) => el.getAttributeNames().find((n) => n.startsWith('data-mx')));
const pendingRule = () => document.head.querySelector(`style[${RUNTIME_PENDING_ATTR}]`)?.textContent ?? null;

let stop = () => {};
const answer = (css: string, ok = true) => vi.fn(async (_url: string, _init?: RequestInit) => new Response(css, { status: ok ? 200 : 404 }));

beforeEach(() => { vi.useFakeTimers(); head(); });
afterEach(() => { stop(); stop = () => {}; vi.useRealTimers(); document.head.innerHTML = ''; document.body.innerHTML = ''; });

describe('runtime classes', () => {
  it('hides a class the sheet lacks at once, asks once per burst, and swaps the whole Tailwind in place', async () => {
    const fetch = answer('.whole{}');
    stop = startRuntimeCss(window, DATA, { credentials: 'include', fetch });
    noteClasses('px-2 bg-lime-500 bg-red-500');
    noteClasses('hover:bg-sky-600');
    noteClasses('w-[37%]');
    // Before any request, in the same task: hidden, and only what is new.
    expect(pendingRule()).toBe('.bg-lime-500,.hover\\:bg-sky-600,.w-\\[37\\%\\]{visibility:hidden!important}');
    expect(fetch).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    // Every runtime class this version needs — the served ones too — sorted: the answer is the whole sheet.
    expect(url).toBe(`/a/doc1/css?v=1&k=v1&x=${encodeURIComponent('bg-lime-500 bg-red-500 hover:bg-sky-600 w-[37%]')}`);
    expect(init.credentials).toBe('include');
    // One Tailwind sheet where the first part stood; the base sheets and the author's CSS still follow it.
    expect(order()).toEqual(['data-mx-tw', 'data-mx-base', 'data-mx-author']);
    expect(document.head.querySelector('style[data-mx-tw]')!.textContent).toBe('.whole{}');
    expect(pendingRule()).toBeNull();
    // Answered classes are never asked again.
    noteClasses('bg-lime-500');
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a page whose rows bring only classes its sheet has never asks', async () => {
    const fetch = answer('');
    stop = startRuntimeCss(window, DATA, { credentials: 'same-origin', fetch });
    noteClasses('px-2 bg-red-500');
    noteClasses('');
    noteClasses(null);
    await vi.runAllTimersAsync();
    expect(fetch).not.toHaveBeenCalled();
    expect(pendingRule()).toBeNull();
    expect(order()[0]).toBe('data-mx-tw-s0');
  });

  it('a failed answer unhides, keeps the sheet, and is not asked again', async () => {
    const fetch = answer('nope', false);
    stop = startRuntimeCss(window, DATA, { credentials: 'same-origin', fetch });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    noteClasses('bg-lime-500');
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(pendingRule()).toBeNull();
    expect(order()[0]).toBe('data-mx-tw-s0');
    noteClasses('bg-lime-500');
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('notes nothing on a page whose data names no door (and on the server)', () => {
    expect(() => noteClasses('bg-lime-500')).not.toThrow();
    expect(pendingRule()).toBeNull();
  });

  it('a row\'s filled class is noted as the kit computes it', async () => {
    const fetch = answer('.whole{}');
    stop = startRuntimeCss(window, DATA, { credentials: 'same-origin', fetch });
    expect(rowClass('rounded', 'px-2 {$_row.cls}', { cls: 'bg-lime-500' })).toBe('rounded px-2 bg-lime-500');
    expect(pendingRule()).toBe('.bg-lime-500{visibility:hidden!important}');
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a newly drawn version asks again, against its own door, for the classes the page drew', async () => {
    const fetch = answer('.whole{}');
    document.body.innerHTML = `<script type="application/json" id="mx-story-data">${JSON.stringify({ css: DATA })}</script>`;
    stop = startRuntimeCss(window, DATA, { credentials: 'same-origin', fetch });
    noteClasses('bg-lime-500');
    await vi.runAllTimersAsync();
    document.body.innerHTML = `<script type="application/json" id="mx-story-data">${JSON.stringify({ css: { url: '/a/doc1/css?v=2&k=v1', known: ['px-2'] } })}</script>`;
    head();
    document.dispatchEvent(new CustomEvent(STORY_VERSION_DRAWN_EVENT, { detail: {} }));
    expect(pendingRule()).toBe('.bg-lime-500{visibility:hidden!important}');
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]![0]).toBe('/a/doc1/css?v=2&k=v1&x=bg-lime-500');
  });

  it('boot starts it from the page data, and only then', async () => {
    const fetch = vi.spyOn(window, 'fetch').mockImplementation(async () => new Response('.whole{}'));
    document.body.innerHTML = '<div data-mx-story-root="" id="mx-story-root"></div>'
      + `<script type="application/json" id="mx-story-data">${JSON.stringify({ values: {}, results: null, signedIn: false, hold: [], mermaidImages: {}, readOnly: null, css: DATA })}</script>`;
    const running = boot({ ISLANDS: [] });
    noteClasses('bg-lime-500');
    await vi.runAllTimersAsync();
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith('/a/doc1/css'))).toHaveLength(1);
    running.dispose();
    noteClasses('bg-sky-500');
    await vi.runAllTimersAsync();
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith('/a/doc1/css'))).toHaveLength(1);
    fetch.mockRestore();
  });

  it('swaps a single inline Tailwind sheet too, and answers false when the page carries none', () => {
    document.head.innerHTML = '<style data-mx-tw>.old{}</style><style data-mx-bare-type>.b{}</style>';
    expect(swapTailwindSheet(document, '.new{}')).toBe(true);
    expect(order()).toEqual(['data-mx-tw', 'data-mx-bare-type']);
    expect(document.head.querySelector('style[data-mx-tw]')!.textContent).toBe('.new{}');
    document.head.innerHTML = '<style data-mx-story-css>.x{}</style>';
    expect(swapTailwindSheet(document, '.new{}')).toBe(false);
  });
});
