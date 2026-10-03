/**
 * The compiled /raw page's own behaviour (lib/islands/page, `@mx/page`): today's inline preludes and
 * reading-position module as one framework-free chunk — `mx-framed`, the reader's per-visit colour
 * override, the live stream of a page with no island module, and the scroll a live reload keeps.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPage } from '../page';
import { LIVE_EDIT_ATTR, LIVE_ID_ATTR, RENDER_ID_PATTERN, STORY_ROOT_SELECTOR } from '@/lib/islands/contract';

class FakeEventSource extends EventTarget {
  static made: FakeEventSource[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(public url: string) { super(); FakeEventSource.made.push(this); }
  closed = false;
  close() { this.closed = true; }
}

const page = ({ live = true, module = false } = {}) => {
  document.documentElement.className = 'light';
  document.body.innerHTML = '<div id="mx-story-root" data-mx-inline-story="" class="light"><p data-mx-ast="0">one</p><p data-mx-ast="1">two</p></div>'
    + (module ? '<script type="application/json" id="mx-story-data">{}</script>' : '');
  if (live) { document.body.setAttribute('data-mx-live-id', 'abc'); document.body.setAttribute('data-mx-live-edit', 'e1'); }
  else { document.body.removeAttribute('data-mx-live-id'); document.body.removeAttribute('data-mx-live-edit'); }
};
const stops: Array<() => void> = [];

afterEach(() => {
  vi.useRealTimers();
  for (const stop of stops.splice(0)) stop();
  FakeEventSource.made = [];
  window.name = '';
  document.documentElement.classList.remove('mx-framed', 'dark');
  document.documentElement.removeAttribute('data-mx-reader-mode');
  vi.unstubAllGlobals();
});

describe('startPage', () => {
  it('wires the served outline and scrolling tables, including later rows', () => {
    page({ live: false });
    document.querySelector('#mx-story-root')!.innerHTML = '<div class="mx-reading"><nav class="mx-outline"><button class="mx-outline-row" data-mx-target="0" type="button">One</button></nav><div class="mx-doc"><h2 data-mx-ast="0">One</h2><table><tr><td>Wide</td></tr></table></div></div>';
    const heading = document.querySelector<HTMLElement>('h2')!;
    const scroll = vi.fn();
    heading.scrollIntoView = scroll;
    heading.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    const table = document.querySelector<HTMLTableElement>('table')!;
    Object.defineProperties(table, { scrollWidth: { value: 300 }, clientWidth: { value: 100 }, scrollLeft: { value: 0, writable: true } });
    stops.push(startPage());
    expect(document.querySelector('.mx-outline-row')?.getAttribute('aria-current')).toBe('true');
    document.querySelector<HTMLElement>('.mx-outline-row')!.click();
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(table.getAttribute('data-mx-scrollable')).toBe('');
    table.scrollLeft = 200;
    table.dispatchEvent(new Event('scroll'));
    expect(table.getAttribute('data-mx-scrollable')).toBe('end');
  });
  it('wires the outline and the tables of a page whose story is replaced after it starts', () => {
    page({ live: false });
    document.querySelector('#mx-story-root')!.innerHTML = '<div class="mx-reading"><nav class="mx-outline"><button class="mx-outline-row" data-mx-target="0" type="button">One</button></nav><div class="mx-doc"><h2 data-mx-ast="0">One</h2><table><tr><td>Wide</td></tr></table></div></div>';
    const heading = document.querySelector<HTMLElement>('h2')!;
    const scroll = vi.fn();
    heading.scrollIntoView = scroll;
    heading.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    const table = document.querySelector<HTMLTableElement>('table')!;
    Object.defineProperties(table, { scrollWidth: { value: 300 }, clientWidth: { value: 100 }, scrollLeft: { value: 0, writable: true } });
    stops.push(startPage());
    document.querySelector<HTMLElement>('.mx-outline-row')!.click();
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    table.scrollLeft = 200;
    table.dispatchEvent(new Event('scroll'));
    expect(table.getAttribute('data-mx-scrollable')).toBe('end');
  });
  it('applies the reader\'s per-visit colour override on <html> and the story root, and nothing without one', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    page();
    window.name = 'mx:doc:' + JSON.stringify({ mode: 'dark' });
    stops.push(startPage());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.getElementById('mx-story-root')!.className).toBe('dark');
    expect(document.documentElement.getAttribute('data-mx-reader-mode')).toBe('dark');
    expect(window.name, 'the override is per visit: it stays for the next reload').toContain('"mode":"dark"');

    window.name = '';
    page();
    stops.push(startPage());
    expect(document.documentElement.className).toBe('light');
    expect(document.documentElement.hasAttribute('data-mx-reader-mode')).toBe(false);
  });

  it('holds the live stream of a page with no island module, and leaves it to boot on one that has', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    page();
    stops.push(startPage());
    expect(FakeEventSource.made.map((s) => s.url)).toEqual(['/a/abc/events']);
    FakeEventSource.made = [];
    page({ module: true });
    stops.push(startPage());
    expect(FakeEventSource.made).toEqual([]);
  });

  it('closes a static compiled page\'s stream when the page is disposed', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    page();
    const stop = startPage();
    const source = FakeEventSource.made.at(-1)!;
    expect(source.closed).toBe(false);
    stop();
    expect(source.closed).toBe(true);
  });

  it('framed: marks <html> mx-framed and holds no stream (the page above does)', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    page();
    const framed = new Proxy(window, { get: (target, key) => (key === 'parent' ? {} : Reflect.get(target, key, target)) });
    stops.push(startPage(document, framed));
    expect(document.documentElement.classList.contains('mx-framed')).toBe(true);
    expect(FakeEventSource.made).toEqual([]);
  });

  it('framed: opens the bridge door before any author script, telling the app origin (and only it) that it may attach', () => {
    page();
    const posted: Array<[unknown, string]> = [];
    const parent = { postMessage: (data: unknown, target: string) => { posted.push([data, target]); } };
    const framed = new Proxy(window, { get: (target, key) => (key === 'parent' ? parent : Reflect.get(target, key, target)) });
    stops.push(startPage(document, framed));
    expect(posted).toContainEqual([{ type: 'mx:frame-bridge', payload: { kind: 'hello' } }, window.location.origin]);
    posted.length = 0;
    stops.push(startPage(document, window));
    expect(posted).toEqual([]);
  });

  it('framed on its own origin: opens the bridge door to the app origin the server named, and still holds its own stream', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    page();
    document.body.setAttribute('data-mx-live-direct', '');
    document.documentElement.setAttribute('data-mx-app-origin', 'https://app.example.test');
    const posted: Array<[unknown, string]> = [];
    const parent = { postMessage: (data: unknown, target: string) => { posted.push([data, target]); } };
    const framed = new Proxy(window, { get: (target, key) => (key === 'parent' ? parent : Reflect.get(target, key, target)) });
    try {
      stops.push(startPage(document, framed));
      expect(posted).toContainEqual([{ type: 'mx:frame-bridge', payload: { kind: 'hello' } }, 'https://app.example.test']);
      expect(FakeEventSource.made.length).toBe(1);
    } finally {
      document.body.removeAttribute('data-mx-live-direct');
      document.documentElement.removeAttribute('data-mx-app-origin');
    }
  });

  it('framed: a link to an app path asks the app page that frames it, never resolving against the document\'s origin', () => {
    page();
    document.querySelector('#mx-story-root')!.innerHTML = '<a href="/a/next" id="next">Next</a><a href="#part" id="part">Part</a>';
    document.documentElement.setAttribute('data-mx-app-origin', 'https://app.example.test');
    const posted: Array<[unknown, string]> = [];
    const parent = { postMessage: (data: unknown, target: string) => { posted.push([data, target]); } };
    const framed = new Proxy(window, { get: (target, key) => (key === 'parent' ? parent : Reflect.get(target, key, target)) });
    const stopJsdom = (event: Event) => event.preventDefault();
    try {
      stops.push(startPage(document, framed));
      window.addEventListener('click', stopJsdom);
      const click = (id: string) => { const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }); document.getElementById(id)!.dispatchEvent(event); };
      click('part');
      click('next');
      expect(posted.filter(([data]) => (data as { type?: string }).type === 'mx:navigate')).toEqual([[{ type: 'mx:navigate', href: '/a/next' }, 'https://app.example.test']]);
    } finally {
      window.removeEventListener('click', stopJsdom);
      document.documentElement.removeAttribute('data-mx-app-origin');
    }
  });

  it('puts the reader back where a live reload left them, and consumes the anchor', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    page({ live: false });
    const [first, second] = [...document.querySelectorAll<HTMLElement>('[data-mx-ast]')];
    first!.getBoundingClientRect = () => ({ top: 0, height: 500, width: 100 }) as DOMRect;
    second!.getBoundingClientRect = () => ({ top: 500, height: 400, width: 100 }) as DOMRect;
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    window.name = 'mx:doc:' + JSON.stringify({ anchor: { path: '1', fraction: 0.5 } });
    stops.push(startPage());
    expect(scrollTo).toHaveBeenCalledWith({ top: 700 });
    expect(window.name, 'one reload, one restore').not.toContain('anchor');
  });

  it('keeps restoring the reader position while a live reload settles', () => {
    vi.useFakeTimers();
    page({ live: false });
    const target = document.querySelector<HTMLElement>('[data-mx-ast="1"]')!;
    let top = 500;
    target.getBoundingClientRect = () => ({ top, height: 400, width: 100 }) as DOMRect;
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    window.name = 'mx:doc:' + JSON.stringify({ anchor: { path: '1', fraction: 0.5 } });
    stops.push(startPage());
    const before = scrollTo.mock.calls.length;
    top = 537;
    vi.advanceTimersByTime(100);
    expect(scrollTo.mock.calls.length).toBeGreaterThan(before);
    vi.useRealTimers();
  });
});

describe('the page protocol', () => {
  it('keeps the page protocol\'s wire names, which stored pages and the served HTML carry', () => {
    expect([STORY_ROOT_SELECTOR, LIVE_ID_ATTR, LIVE_EDIT_ATTR]).toEqual(['[data-mx-inline-story]', 'data-mx-live-id', 'data-mx-live-edit']);
    expect(['s0-', 'd-', 's-abc_1'].every((id) => RENDER_ID_PATTERN.test(id))).toBe(true);
    expect(['', 's0 ', '"]', 's0-,x'].some((id) => RENDER_ID_PATTERN.test(id))).toBe(false);
  });
});
