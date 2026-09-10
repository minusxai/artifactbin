import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppBar } from '../PageChrome';
import { InlineReaderChrome } from '../InlineReaderChrome';

let now = Date.now();
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('always shows theme-inheriting icons, shares the count request, and preserves reader counts across updates', async () => {
  now += 120_000;
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const fetch = vi.fn().mockResolvedValue(Response.json({ stars: 1234 }));
  vi.stubGlobal('fetch', fetch);
  const input = { artifactId: 'abcdef', title: 'Before', author: null };
  const content = (title: string) => <MemoryRouter><AppBar /><InlineReaderChrome input={{ ...input, title }} onAction={() => {}} /></MemoryRouter>;
  const view = render(content('Before'));
  const icons = view.container.querySelectorAll('[data-mx-github-star] svg');
  expect(icons.length).toBeGreaterThanOrEqual(3);
  for (const icon of icons) {
    expect(icon.getAttribute('fill')).toBe('#eac54f');
    expect(icon.closest('a')?.textContent).toContain('Star');
    expect(icon.closest('a')?.getAttribute('href')).toBe('https://github.com/minusxai/artifactbin');
  }
  expect(view.container.querySelector('[data-mx-github-star] iframe')).toBeNull();
  await act(async () => {});
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith('/api/external/github', { credentials: 'omit', cache: 'no-store' });
  const count = view.container.querySelector('[data-mx-reader-chrome] [data-mx-github-count]')!;
  expect(count.textContent).toBe('1,234');
  expect(count.hasAttribute('hidden')).toBe(false);
  view.rerender(content('After'));
  await act(async () => {});
  expect(view.container.querySelector('[data-mx-reader-chrome] [data-mx-github-count]')).toBe(count);
  expect(count.textContent).toBe('1,234');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('keeps the repository icon and link usable when the count request fails', async () => {
  now += 120_000;
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const view = render(<InlineReaderChrome input={{ artifactId: null, title: null, author: null }} onAction={() => {}} />);
  await act(async () => {});
  expect(view.container.querySelector('[data-mx-github-star] a svg')).toBeTruthy();
  expect(view.container.querySelector('[data-mx-github-count]')?.hasAttribute('hidden')).toBe(true);
});
