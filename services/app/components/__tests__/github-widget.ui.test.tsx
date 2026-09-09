import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppBar } from '../PageChrome';
import { InlineReaderChrome } from '../InlineReaderChrome';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('sizes only from its own sandbox and swaps the fallback in-place', () => {
  const view = render(<MemoryRouter><AppBar /></MemoryRouter>);
  const frame = view.container.querySelector<HTMLIFrameElement>('header iframe')!;
  const fallback = frame.parentElement!.querySelector<HTMLAnchorElement>('a')!;
  const send = (source: Window | null, width: unknown) => window.dispatchEvent(new MessageEvent('message', {
    origin: 'null', source, data: { type: 'github-widget-size', width, height: 28 },
  }));
  expect(fallback.style.display).not.toBe('none');
  send(window, 99);
  expect(frame.style.visibility).toBe('hidden');
  send(frame.contentWindow, 99);
  expect(frame.style.width).toBe('99px');
  expect(frame.style.visibility).toBe('visible');
  expect(fallback.style.display).toBe('none');
  for (const width of [-1, 10000, '120', NaN]) send(frame.contentWindow, width);
  expect(frame.style.width).toBe('99px');
  send(frame.contentWindow, 128.5);
  expect(frame.style.width).toBe('129px');
  view.unmount();
  send(frame.contentWindow, 150);
  expect(frame.style.width).toBe('129px');
});
it('tracks actual app and reader palettes separately and stops watching after unmount', async () => {
  const style = document.createElement('style');
  style.textContent = 'header [data-mx-github-star]{color-scheme:light}:root[data-theme="dark"] header [data-mx-github-star]{color-scheme:dark}';
  document.head.append(style);
  document.documentElement.dataset.theme = 'dark';
  try {
    const view = render(<MemoryRouter><AppBar /><InlineReaderChrome input={{ artifactId: null, title: null, author: null }} onAction={() => {}} /></MemoryRouter>);
    const app = view.container.querySelector<HTMLIFrameElement>('header iframe')!;
    const reader = view.container.querySelector<HTMLIFrameElement>('[data-mx-reader-chrome] iframe')!;
    const chrome = reader.closest<HTMLElement>('[data-mx-reader-chrome]')!;
    const scheme = (frame: HTMLIFrameElement) => new URLSearchParams(new URL(frame.src).hash.slice(1)).get('data-color-scheme');
    expect(scheme(app)).toBe('dark');
    expect(new URL(app.src).searchParams.get('theme')).toBe('dark');
    expect(scheme(reader)).toBe('light'); // The actual reader bar is white despite the app's root theme.
    await act(async () => { chrome.style.setProperty('--mx-reader-scheme', 'dark'); document.documentElement.dataset.theme = 'light'; });
    expect(scheme(app)).toBe('light');
    expect(scheme(reader)).toBe('dark');
    expect(new URL(reader.src).searchParams.get('theme')).toBe('dark');
    const write = vi.spyOn(reader, 'setAttribute');
    await act(async () => { chrome.classList.add('unrelated-state'); });
    expect(write).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => { chrome.style.setProperty('--mx-reader-scheme', 'light'); });
    expect(write).not.toHaveBeenCalled();
  } finally { style.remove(); delete document.documentElement.dataset.theme; }
});
it('embeds the star-count vendor in sandboxed frames in both app and reader chrome without parent count requests', () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ count: 3 })));
  vi.stubGlobal('fetch', fetch);
  const { container } = render(<MemoryRouter><AppBar /><InlineReaderChrome input={{ artifactId: null, title: null, author: null }} onAction={() => {}} /></MemoryRouter>);
  const app = container.querySelector('header [data-mx-github-star]');
  const rail = container.querySelector('[data-mx-reader-rail]')!;
  const reader = rail.firstElementChild!;
  for (const host of [app, reader]) {
    const frame = host?.matches('iframe') ? host : host?.querySelector('iframe');
    expect(frame).toBeTruthy();
    const url = new URL((frame as HTMLIFrameElement).src);
    expect(url.pathname).toBe('/-/github-star');
    const options = new URLSearchParams(url.hash.slice(1));
    expect(options.get('data-show-count')).toBe('true');
    // A white chrome surface must never inherit the visitor's dark OS theme.
    expect(options.get('data-color-scheme')).toBe('light');
    expect(url.hash).not.toContain('+');
    expect(frame!.getAttribute('sandbox')).toBe('allow-scripts allow-popups allow-popups-to-escape-sandbox');
    expect(frame!.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect((frame as HTMLIFrameElement).style.colorScheme).toBe('normal');
    expect(frame!.getAttribute('title')).toBeTruthy();
  }
  expect(rail.children[1].getAttribute('data-mx-reader-action')).toBe('like');
  expect(fetch).not.toHaveBeenCalled();
});
