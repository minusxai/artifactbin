import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AssetsPage } from '@/web/pages/Assets';

vi.mock('@/web/session', () => ({ useSession: () => ({ session: { user: { id: 'usr_1', email: 'owner@example.com' } } }) }));

const payload = {
  page: 0, perPage: 50, total: 2, formats: ['dataset', 'image'], visibilities: ['private'],
  assets: [
    { id: 'data_1', url: '/a/data_1', title: 'Revenue.csv', format: 'dataset', version: 2, visibility: 'private', ancestor_ids: ['folder_1'], updated_at: '2026-09-05T06:00:00.000Z' },
    { id: 'image_1', url: '/a/image_1', title: 'Research Map.svg', format: 'image', version: 1, visibility: 'private', ancestor_ids: [], updated_at: '2026-09-04T06:00:00.000Z' },
  ],
  folders: [
    { id: 'folder_1', url: '/a/folder_1', title: 'Research', format: 'folder', version: 1, visibility: 'private', ancestor_ids: [], updated_at: '2026-09-01T06:00:00.000Z' },
  ],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (
    String(url).startsWith('/api/page/assets')
      ? new Response(JSON.stringify(String(url).includes('q=Revenue') ? { ...payload, assets: [payload.assets[0]], total: 1 } : payload), { status: 200 })
      : new Response('{}', { status: 404 })
  )));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('assets page', () => {
  it('links to dataset creation', async () => {
    render(<MemoryRouter><AssetsPage /></MemoryRouter>);
    expect(await screen.findByLabelText('Create dataset')).toHaveAttribute('href', '/datasets/new');
  });

  it('renders the existing management table with asset-specific search', async () => {
    render(<MemoryRouter><AssetsPage /></MemoryRouter>);

    const table = await screen.findByRole('table');
    expect(table).toHaveTextContent('Revenue.csv');
    expect(table).toHaveTextContent('Research Map.svg');
    expect(screen.getByLabelText('Search assets')).toHaveAttribute('placeholder', 'search assets');
    expect(screen.getByLabelText('Filter dataset')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter image')).toBeInTheDocument();
    expect(screen.queryByLabelText('Share Revenue.csv')).toBeNull();
    expect(screen.queryByLabelText('Edit Revenue.csv')).toBeNull();

    fireEvent.change(screen.getByLabelText('Search assets'), { target: { value: 'Revenue' } });
    await waitFor(() => expect(table).not.toHaveTextContent('Research Map.svg'));
  });

  it('paginates on the server and searches assets outside the loaded page', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const params = new URL(String(url), 'http://localhost').searchParams;
      const assets = params.has('q') ? [{ ...payload.assets[0], title: 'Old asset' }]
        : params.get('page') === '1' ? [{ ...payload.assets[1], title: 'Second page' }] : payload.assets;
      return new Response(JSON.stringify({ ...payload, assets, total: params.has('q') ? 1 : 51, page: Number(params.get('page') ?? 0) }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><AssetsPage /></MemoryRouter>);
    await screen.findByRole('table');
    fireEvent.click(screen.getByLabelText('Next page'));
    await screen.findByText('Second page');
    fireEvent.change(screen.getByLabelText('Search assets'), { target: { value: 'Old asset' } });
    await screen.findByText('Old asset');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('q=Old+asset') && !String(url).includes('page=1'))).toBe(true);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('/api/page/assets'))).toBe(true);
  });

  it('reports a missing assets endpoint without falling back to Home', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><AssetsPage /></MemoryRouter>);
    await screen.findByLabelText('Assets unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
