import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { TrashPage } from '@/web/pages/Trash';

vi.mock('@/web/session', () => ({ useSession: () => ({ session: { user: { id: 'usr_1', email: 'owner@example.com' } } }) }));

const files = [
  { id: 'doc_1', title: 'Quarterly Review', format: 'markup', version: 3, deleted_at: '2026-09-05T06:00:00.000Z' },
  { id: 'data_1', title: 'Revenue.csv', format: 'dataset', version: 1, deleted_at: '2026-09-04T06:00:00.000Z' },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url) === '/api/page/trash') return new Response(JSON.stringify({ files }), { status: 200 });
    if (String(url) === '/api/my/artifacts/doc_1/restore' && init?.method === 'POST') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('trash table', () => {
  it('uses the shelf table language and restores from the row menu', async () => {
    render(<MemoryRouter><TrashPage /></MemoryRouter>);

    const table = await screen.findByRole('table');
    expect(table).toHaveTextContent('Quarterly Review');
    expect(table).toHaveTextContent('Revenue.csv');
    expect(screen.getByText('type')).toBeInTheDocument();
    expect(screen.getByText('ver')).toBeInTheDocument();
    expect(screen.getByText('deleted')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter markup')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter dataset')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search trash'), { target: { value: 'Quarterly' } });
    expect(table).toHaveTextContent('Quarterly Review');
    expect(table).not.toHaveTextContent('Revenue.csv');

    fireEvent.click(screen.getByLabelText('More actions for Quarterly Review'));
    fireEvent.click(screen.getByLabelText('Restore Quarterly Review'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/my/artifacts/doc_1/restore',
      { method: 'POST', credentials: 'same-origin' },
    ));
    await waitFor(() => expect(table).not.toHaveTextContent('Quarterly Review'));
  });
});
