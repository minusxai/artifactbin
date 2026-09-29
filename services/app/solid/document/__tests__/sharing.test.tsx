/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import { DocumentSharing } from '../DocumentSharing';

afterEach(() => vi.unstubAllGlobals());

it('opens the owner sharing dialog and changes link visibility through the scoped endpoint', async () => {
  const state = { visibility: 'unlisted', linkRole: 'viewer', shares: [], canPrivate: true };
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => Response.json(init?.method === 'PUT' ? { ...state, visibility: 'public' } : state));
  vi.stubGlobal('fetch', fetcher);
  const view = render(() => <DocumentSharing id="abc" title="Report" owner />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Sharing' })).toHaveTextContent('Anyone with the link'));
  fireEvent.click(screen.getByRole('button', { name: 'Make public' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/my/artifacts/abc/sharing', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ visibility: 'public' }) })));
});

it('copies a clean reader link without loading ACLs', async () => {
  const copy = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const view = render(() => <DocumentSharing id="abc" title="Report" owner={false} url="/a/abc?version=1#edit" />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  expect(copy).toHaveBeenCalledWith(`${location.origin}/a/abc`);
  expect(fetcher).not.toHaveBeenCalled();
});
