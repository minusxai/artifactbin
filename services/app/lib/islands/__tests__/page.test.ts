/**
 * The compiled /raw page's own behaviour (lib/islands/page, `@mx/page`): today's inline preludes and
 * reading-position module as one framework-free chunk — `mx-framed`, the reader's per-visit colour
 * override, the live stream of a page with no island module, and the scroll a live reload keeps.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPage, CHROME_HIDDEN_CLASS } from '../page';
import { STORY_SCROLL_MESSAGE } from '@/lib/story-runtime/contract';
import { READER_CHROME_HIDDEN_CLASS } from '@/lib/story/reader-chrome';

class FakeEventSource extends EventTarget {
  static made: FakeEventSource[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(public url: string) { super(); FakeEventSource.made.push(this); }
  close() {}
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
  for (const stop of stops.splice(0)) stop();
  FakeEventSource.made = [];
  window.name = '';
  document.documentElement.classList.remove('mx-framed', 'dark');
  vi.unstubAllGlobals();
});

describe('startPage', () => {
  it('applies the reader\'s per-visit colour override on <html> and the story root, and nothing without one', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    page();
    window.name = 'mx:doc:' + JSON.stringify({ mode: 'dark' });
    stops.push(startPage());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.getElementById('mx-story-root')!.className).toBe('dark');
    expect(window.name, 'the override is per visit: it stays for the next reload').toContain('"mode":"dark"');

    window.name = '';
    page();
    stops.push(startPage());
    expect(document.documentElement.className).toBe('light');
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

  it('framed: marks <html> mx-framed and holds no stream (the page above does)', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    page();
    const postMessage = vi.fn();
    const framed = new Proxy(window, { get: (target, key) => (key === 'parent' ? { postMessage } : Reflect.get(target, key, target)) });
    stops.push(startPage(document, framed));
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: STORY_SCROLL_MESSAGE }), '*');
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
});
