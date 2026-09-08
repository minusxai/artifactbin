import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AssetsPage } from '@/web/pages/Assets';

vi.mock('@/web/session', () => ({ useSession: () => ({ session: { user: { id: 'usr_1', email: 'owner@example.com' } } }) }));

const payload = {
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
    String(url) === '/api/page/assets'
      ? new Response(JSON.stringify(payload), { status: 200 })
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

  it('uses the mounted Home endpoint until a newly-generated Assets route is picked up by a server restart', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url) === '/api/page/assets') return new Response('{}', { status: 404 });
      if (String(url) === '/api/page/home') return new Response(JSON.stringify({
        signedIn: true,
        artifacts: [...payload.assets, ...payload.folders, { id: 'doc_1', url: '/a/doc_1', title: 'Document', format: 'markup', version: 1, updated_at: '2026-09-05T06:00:00.000Z' }],
      }), { status: 200 });
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter><AssetsPage /></MemoryRouter>);

    const table = await screen.findByRole('table');
    expect(table).toHaveTextContent('Revenue.csv');
    expect(table).toHaveTextContent('Research Map.svg');
    expect(table).not.toHaveTextContent('Document');
    expect(fetchMock).toHaveBeenCalledWith('/api/page/home', { credentials: 'same-origin' });
  });
});
