/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route } from '@solidjs/router';
import { AssetsPage } from '@/solid/pages/Assets';

vi.mock('@/solid/web/session', () => ({ useSession: () => ({ session: () => ({ user: { id: 'usr_1', email: 'owner@example.com' } }) }) }));
const payload = {
  page: 0, perPage: 50, total: 2, formats: ['dataset', 'image'], visibilities: ['private'],
  assets: [
    { id: 'data_1', url: '/a/data_1', title: 'Revenue.csv', format: 'dataset', version: 2, visibility: 'private', ancestor_ids: ['folder_1'], updated_at: '2026-09-05T06:00:00.000Z' },
    { id: 'image_1', url: '/a/image_1', title: 'Research Map.svg', format: 'image', version: 1, visibility: 'private', ancestor_ids: [], updated_at: '2026-09-04T06:00:00.000Z' },
  ],
  folders: [{ id: 'folder_1', url: '/a/folder_1', title: 'Research', format: 'folder', version: 1, visibility: 'private', ancestor_ids: [], updated_at: '2026-09-01T06:00:00.000Z' }],
};
const open = () => render(() => <MemoryRouter><Route path="*" component={AssetsPage} /></MemoryRouter>);
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(String(url).includes('q=Revenue') ? { ...payload, assets: [payload.assets[0]], total: 1 } : payload))));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('links to upload and dataset creation and searches assets', async () => {
  open();
  expect(await screen.findByLabelText('Create dataset')).toHaveAttribute('href', '/datasets/new');
  expect(screen.getByLabelText('Upload file')).toHaveAttribute('href', '/files/new');
  const table = await screen.findByRole('table');
  expect(table).toHaveTextContent('Revenue.csv');
  expect(table).toHaveTextContent('Research Map.svg');
  expect(screen.getByLabelText('Search assets')).toHaveAttribute('placeholder', 'search assets');
  expect(screen.getByLabelText('Filter dataset')).toBeInTheDocument();
  expect(screen.getByLabelText('Filter image')).toBeInTheDocument();
  expect(screen.queryByLabelText('Share Revenue.csv')).toBeNull();
  expect(screen.queryByLabelText('Edit Revenue.csv')).toBeNull();
  fireEvent.input(screen.getByLabelText('Search assets'), { target: { value: 'Revenue' } });
  await waitFor(() => expect(table).not.toHaveTextContent('Research Map.svg'));
});

it('paginates on the server and resets the page when searching', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    const params = new URL(String(url), 'http://localhost').searchParams;
    const assets = params.has('q') ? [{ ...payload.assets[0], title: 'Old asset' }]
      : params.get('page') === '1' ? [{ ...payload.assets[1], title: 'Second page' }] : payload.assets;
    return Response.json({ ...payload, assets, total: params.has('q') ? 1 : 51, page: Number(params.get('page') ?? 0) });
  });
  vi.stubGlobal('fetch', fetchMock);
  open();
  await screen.findByRole('table');
  fireEvent.click(screen.getByLabelText('Next page'));
  await screen.findByText('Second page');
  fireEvent.input(screen.getByLabelText('Search assets'), { target: { value: 'Old asset' } });
  await screen.findByText('Old asset');
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('q=Old+asset') && !String(url).includes('page=1'))).toBe(true);
});

it('reports a missing assets endpoint and offers retry', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 404 })));
  open();
  expect(await screen.findByLabelText('Assets unavailable')).toBeInTheDocument();
  expect(screen.getByLabelText('Retry assets')).toBeInTheDocument();
});
