/* @jsxImportSource solid-js */
/**
 * The trash page, by accessible name. The router is an explicit <MemoryRouter> whose one route renders the
 * page (testing-library's `location` option passes the page as a child, which @solidjs/router reads as route
 * definitions and renders nothing). The first table assertion waits for the rows, which arrive after the table.
 * Typing is `fireEvent.input`: the page filters on every keystroke, and Solid's `onChange` fires on blur.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { MemoryRouter, Route } from '@solidjs/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrashPage } from '@/solid/pages/Trash';
import { stubFetch } from '@/test/helpers/fetch-stub';

vi.mock('@/solid/lib/session', () => ({ useSession: () => ({ session: () => ({ user: { id: 'usr_1', email: 'owner@example.com' } }) }) }));

const files = [
  { id: 'doc_1', title: 'Quarterly Review', format: 'markup', version: 3, deleted_at: '2026-09-05T06:00:00.000Z' },
  { id: 'data_1', title: 'Revenue.csv', format: 'dataset', version: 1, deleted_at: '2026-09-04T06:00:00.000Z' },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = stubFetch({
    '/api/page/trash': () => new Response(JSON.stringify({ files }), { status: 200 }),
    'POST /api/my/artifacts/doc_1/restore': () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  }, { fallback: () => new Response('{}', { status: 404 }) });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('trash table', () => {
  it('uses the shelf table language and restores from the row menu', async () => {
    render(() => <MemoryRouter><Route path="*" component={TrashPage} /></MemoryRouter>);

    const table = await screen.findByRole('table');
    await waitFor(() => expect(table).toHaveTextContent('Quarterly Review'));
    expect(table).toHaveTextContent('Revenue.csv');
    expect(screen.getByText('type')).toBeInTheDocument();
    expect(screen.getByText('ver')).toBeInTheDocument();
    expect(screen.getByText('deleted')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter markup')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter dataset')).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText('Search trash'), { target: { value: 'Quarterly' } });
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
