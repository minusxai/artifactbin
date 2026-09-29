/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import { RefreshDocumentAssets } from '../RefreshDocumentAssets';
afterEach(() => vi.unstubAllGlobals());

it('posts to the refresh door and names updated images', async () => {
  const fetcher = vi.fn(async () => Response.json({ refreshed: ['https://example.com/a.png'], unchanged: [], failed: [] }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(() => <RefreshDocumentAssets id="abc" />);
  fireEvent.click(view.getByRole('button', { name: 'Refresh external images' }));
  await waitFor(() => expect(view.getByRole('status', { name: 'Refresh result' })).toHaveTextContent('1 refreshed'));
  expect(fetcher).toHaveBeenCalledWith('/api/my/artifacts/abc/assets/refresh', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
});

it('reports unchanged or absent external images', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ refreshed: [], unchanged: ['one'], failed: [] })));
  const view = render(() => <RefreshDocumentAssets id="abc" />);
  fireEvent.click(view.getByRole('button', { name: 'Refresh external images' }));
  await waitFor(() => expect(view.getByRole('status', { name: 'Refresh result' })).toHaveTextContent('already up to date'));
});

it('names the failed URL and fix', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ refreshed: [], failed: [{ url: 'https://example.com/a.png', fix: 'Log in at source', code: 'auth' }] })));
  const view = render(() => <RefreshDocumentAssets id="abc" />);
  fireEvent.click(view.getByRole('button', { name: 'Refresh external images' }));
  await waitFor(() => expect(view.getByRole('status', { name: 'Refresh result' })).toHaveTextContent('https://example.com/a.png — Log in at source'));
});

it('does not fire twice on a double click', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn(async () => { await pending; return Response.json({ refreshed: [] }); });
  vi.stubGlobal('fetch', fetcher);
  const view = render(() => <RefreshDocumentAssets id="abc" />);
  const button = view.getByRole('button', { name: 'Refresh external images' });
  fireEvent.click(button); fireEvent.click(button);
  expect(fetcher).toHaveBeenCalledTimes(1);
  release();
});
