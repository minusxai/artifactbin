/**
 * THE CHROME'S BEHAVIOUR in jsdom, over the REAL markup the server renders
 * (lib/story/reader-chrome) so the wiring and the contract cannot drift.
 *
 * jsdom has no layout: the viewport and the document height are stubbed on
 * the window, and the animation frame runs inline so an assertion is about
 * the rule and not about a timer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderReaderChrome } from '@/lib/story/reader-chrome';
import { wireReaderChrome } from '@/lib/story-runtime/reader-chrome-actions';

// `writable` matters: vi.useFakeTimers() ASSIGNS window.requestAnimationFrame,
// and a non-writable stub left by an earlier mount() makes that throw.
const set = (target: object, key: string, value: unknown) =>
  Object.defineProperty(target, key, { configurable: true, writable: true, value });

function mount(documentHeight = 4000) {
  document.body.innerHTML = '<div id="mx-story-root"><p>the document</p></div>'
    + renderReaderChrome({ artifactId: 'ab12cd', title: 'Quarterly review', author: { username: 'ada' } });
  set(window, 'requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  set(window, 'innerHeight', 800);
  set(window, 'scrollY', 0);
  set(document.documentElement, 'scrollHeight', documentHeight);
  const handle = wireReaderChrome(window, document);
  const root = document.querySelector<HTMLElement>('[data-mx-reader-chrome]')!;
  return { root, handle };
}

const hidden = (root: HTMLElement) => root.classList.contains('mx-reader-chrome--hidden');
const scrollTo = (y: number) => { set(window, 'scrollY', y); window.dispatchEvent(new Event('scroll')); };
const click = (selector: string) => {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  el.click();
};
const tick = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.classList.remove('dark', 'light');
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('wireReaderChrome — visibility', () => {
  it('keeps the chrome hidden on load, reveals it on a scroll up, hides it on a scroll down', () => {
    const { root } = mount();
    expect(hidden(root)).toBe(true);
    expect(root.getAttribute('data-mx-reader-state')).toBe('hidden');
    scrollTo(600);
    expect(hidden(root)).toBe(true);
    scrollTo(560);
    expect(hidden(root)).toBe(false);
    expect(root.getAttribute('data-mx-reader-state')).toBe('shown');
    scrollTo(700);
    expect(hidden(root)).toBe(true);
    expect(root.getAttribute('data-mx-reader-state')).toBe('hidden');
  });

  it('shows it at once on a document that cannot scroll', () => {
    const { root } = mount(600);
    expect(hidden(root)).toBe(false);
    expect(root.getAttribute('data-mx-reader-state')).toBe('shown');
  });

  it('shows it at the end of the document', () => {
    const { root } = mount();
    scrollTo(3200);
    expect(hidden(root)).toBe(false);
  });

  it('re-samples on resize', () => {
    const { root } = mount();
    set(window, 'innerHeight', 5000);
    window.dispatchEvent(new Event('resize'));
    expect(hidden(root)).toBe(false);
  });

  it('holds still while a panel is open, and opening one reveals it', () => {
    const { root } = mount();
    scrollTo(600);
    scrollTo(560);
    expect(hidden(root)).toBe(false);
    click('[data-mx-reader-trigger="controls"]');
    const panel = document.querySelector<HTMLElement>('[data-mx-reader-panel="controls"]')!;
    expect(panel.hidden).toBe(false);
    expect(document.querySelector('[data-mx-reader-trigger="controls"]')!.getAttribute('aria-expanded')).toBe('true');
    scrollTo(900);
    expect(hidden(root)).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.hidden).toBe(true);
    scrollTo(1000);
    expect(hidden(root)).toBe(true);
    click('[data-mx-reader-trigger="menu"]');
    expect(hidden(root)).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-mx-reader-panel="menu"]')!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-mx-reader-scrim]')!.hidden).toBe(false);
  });

  it('destroys cleanly', () => {
    const { root, handle } = mount();
    handle?.destroy();
    scrollTo(600);
    scrollTo(560);
    expect(hidden(root)).toBe(true);
  });

  it('returns null when the document carries no chrome', () => {
    document.body.innerHTML = '<div id="mx-story-root"><p>a capture</p></div>';
    expect(wireReaderChrome(window, document)).toBeNull();
  });
});

describe('wireReaderChrome — the rail', () => {
  it('logs like and comment with the artifact id, and nothing else happens', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mount();
    click('[data-mx-reader-action="like"]');
    expect(log).toHaveBeenCalledWith('[artifactbin] like', { artifact: 'ab12cd' });
    click('[data-mx-reader-action="comment"]');
    expect(log).toHaveBeenCalledWith('[artifactbin] comment', { artifact: 'ab12cd' });
  });

  it('logs follow with the artifact and the author', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mount();
    click('[data-mx-reader-action="follow"]');
    expect(log).toHaveBeenCalledWith('[artifactbin] follow', { artifact: 'ab12cd', author: 'ada' });
  });

  it('shares through the platform sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    set(navigator, 'share', share);
    mount();
    click('[data-mx-reader-action="share"]');
    expect(share).toHaveBeenCalledWith({ title: 'Quarterly review', url: window.location.href });
  });

  it('falls back to the clipboard and says so, briefly', async () => {
    set(navigator, 'share', undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    set(navigator, 'clipboard', { writeText });
    vi.useFakeTimers();
    mount();
    click('[data-mx-reader-action="share"]');
    await tick();
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    const toast = document.querySelector<HTMLElement>('[data-mx-reader-toast]')!;
    expect(toast.hidden).toBe(false);
    vi.advanceTimersByTime(2500);
    expect(toast.hidden).toBe(true);
  });

  it('leaves the logo a plain link home', () => {
    mount();
    const logo = document.querySelector<HTMLAnchorElement>('[data-mx-reader-logo]')!;
    expect(logo.getAttribute('href')).toBe('/');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    logo.dispatchEvent(click);
    // Nothing in the chrome's wiring intercepts it (the UI harness cancels every anchor).
    expect(document.querySelector('[data-mx-reader-logo]')).toBe(logo);
  });

  it('flips the reader mode from the settings panel', () => {
    mount();
    click('[data-mx-mode-choice="dark"]');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.querySelector('[data-mx-mode-choice="dark"]')!.getAttribute('aria-pressed')).toBe('true');
    click('[data-mx-mode-choice="light"]');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
