/**
 * The compiled /raw page's own behaviour (lib/islands/page, `@mx/page`): today's inline preludes and
 * reading-position module as one framework-free chunk — `mx-framed`, the reader's per-visit colour
 * override, the live stream of a page with no island module, and the scroll a live reload keeps.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPage, CHROME_HIDDEN_CLASS } from '../page';
import { READER_CHROME_HIDDEN_CLASS } from '@/lib/story/reader/reader-chrome';
import { captureInitialStory, clearInitialStory } from '@/web/initial-story';
import { PAGE_TAKEOVER_EVENT } from '@/lib/islands/page-lifetime';
import { LIVE_EDIT_ATTR, LIVE_ID_ATTR, PUBLIC_MX_KEY, RENDER_ID_PATTERN, STORY_ROOT_SELECTOR } from '@/lib/islands/contract';

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
  it('keeps the outline and table wiring live once the SPA takes the page over — nothing there replaces it', () => {
    page({ live: false });
    document.querySelector('#mx-story-root')!.innerHTML = '<div class="mx-reading"><nav class="mx-outline"><button class="mx-outline-row" data-mx-target="0" type="button">One</button></nav><div class="mx-doc"><h2 data-mx-ast="0">One</h2><table><tr><td>Wide</td></tr></table></div></div>';
    const heading = document.querySelector<HTMLElement>('h2')!;
    const scroll = vi.fn();
    heading.scrollIntoView = scroll;
    heading.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    const table = document.querySelector<HTMLTableElement>('table')!;
    Object.defineProperties(table, { scrollWidth: { value: 300 }, clientWidth: { value: 100 }, scrollLeft: { value: 0, writable: true } });
    stops.push(startPage());
    window.dispatchEvent(new Event(PAGE_TAKEOVER_EVENT));
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

  it('closes a static compiled page stream when the app takes over for editing', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    page();
    stops.push(startPage());
    captureInitialStory();
    const source = FakeEventSource.made.at(-1)!;
    expect(source.closed).toBe(false);
    clearInitialStory();
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

  it('keeps restoring the reader position while the SPA takes over a settling page', () => {
    vi.useFakeTimers();
    page({ live: false });
    const target = document.querySelector<HTMLElement>('[data-mx-ast="1"]')!;
    let top = 500;
    target.getBoundingClientRect = () => ({ top, height: 400, width: 100 }) as DOMRect;
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    window.name = 'mx:doc:' + JSON.stringify({ anchor: { path: '1', fraction: 0.5 } });
    stops.push(startPage());
    const before = scrollTo.mock.calls.length;
    window.dispatchEvent(new Event(PAGE_TAKEOVER_EVENT));
    top = 537;
    vi.advanceTimersByTime(100);
    expect(scrollTo.mock.calls.length).toBeGreaterThan(before);
    vi.useRealTimers();
  });
});

describe('the served reader chrome on the compiled app page', () => {
  const at = (y: number) => { Object.defineProperty(window, 'scrollY', { value: y, configurable: true }); window.dispatchEvent(new Event('scroll')); };
  it('follows today\'s rule until the app takes it over: shown on load, a scroll down hides it, a scroll up reveals it, the end shows it', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 0; });
    page();
    document.body.insertAdjacentHTML('beforeend', '<nav data-mx-reader-chrome="" data-mx-reader-state="shown"></nav>');
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    at(0);
    stops.push(startPage());
    const chrome = document.querySelector<HTMLElement>('[data-mx-reader-chrome]')!;
    expect(chrome.getAttribute('data-mx-reader-state')).toBe('shown');
    at(600);
    expect([chrome.getAttribute('data-mx-reader-state'), chrome.classList.contains(CHROME_HIDDEN_CLASS)]).toEqual(['hidden', true]);
    at(300);
    expect([chrome.getAttribute('data-mx-reader-state'), chrome.classList.contains(CHROME_HIDDEN_CLASS)]).toEqual(['shown', false]);
    at(900);
    expect(chrome.getAttribute('data-mx-reader-state')).toBe('hidden');
    at(4200);
    expect(chrome.getAttribute('data-mx-reader-state'), 'the end of the document shows it').toBe('shown');
    // The app's chrome replaces the served one: nothing here touches it any more.
    chrome.remove();
    const app = document.createElement('nav');
    app.setAttribute('data-mx-reader-chrome', '');
    document.body.append(app);
    at(600);
    expect(app.hasAttribute('data-mx-reader-state')).toBe(false);
    app.remove();
  });

  it('names today\'s hidden class', () => {
    expect(CHROME_HIDDEN_CLASS).toBe(READER_CHROME_HIDDEN_CLASS);
  });

  it('keeps the page protocol\'s wire names, which stored pages and the served HTML carry', () => {
    expect([STORY_ROOT_SELECTOR, LIVE_ID_ATTR, LIVE_EDIT_ATTR, PUBLIC_MX_KEY]).toEqual(['[data-mx-inline-story]', 'data-mx-live-id', 'data-mx-live-edit', '__mxPublicApi']);
    expect(['s0-', 'd-', 's-abc_1'].every((id) => RENDER_ID_PATTERN.test(id))).toBe(true);
    expect(['', 's0 ', '"]', 's0-,x'].some((id) => RENDER_ID_PATTERN.test(id))).toBe(false);
  });
});
