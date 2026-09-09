import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppBar } from '../PageChrome';
import { InlineReaderChrome } from '../InlineReaderChrome';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
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
    const url = new URL(frame!.getAttribute('src')!);
    expect(url.origin + url.pathname).toBe('https://buttons.github.io/buttons.html');
    const options = new URLSearchParams(url.hash.slice(1));
    expect(options.get('href')).toBe('https://github.com/minusxai/artifactbin');
    expect(options.get('data-show-count')).toBe('true');
    expect(url.hash).not.toContain('+');
    expect(url.hash).toContain('Star%20artifactbin%20on%20GitHub');
    expect(frame!.getAttribute('sandbox')).toBe('allow-scripts allow-popups allow-popups-to-escape-sandbox');
    expect(frame!.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame!.getAttribute('title')).toBeTruthy();
  }
  expect(rail.children[1].getAttribute('data-mx-reader-action')).toBe('like');
  expect(fetch).not.toHaveBeenCalled();
});
