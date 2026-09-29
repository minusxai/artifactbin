/* @jsxImportSource solid-js */
/**
 * The Solid port of web/__tests__/trash-page.ui.test.tsx: the same fixtures and the same assertions,
 * by accessible name. Three differences in how the test drives the page, none an assertion:
 * - the router is an explicit <MemoryRouter> whose one route renders the page — the analogue of the
 *   React test's <MemoryRouter><TrashPage /></MemoryRouter>. (testing-library's `location` option
 *   passes the page as a CHILD of MemoryRouter; @solidjs/router 1.x reads children as route
 *   definitions, so that renders nothing — observed, see .agent/REPORT.md.)
 * - the first assertion on the table waits for the rows: React's findBy* runs inside act(), which
 *   also flushes the stubbed fetch; Solid has no act(), so the data arrives after the table does.
 * - typing is `fireEvent.input`: React's `onChange` IS the native `input` event, while Solid's
 *   `onChange` is the native `change` event (fires on blur). The page filters on every keystroke,
 *   so it listens to `input`, and the test dispatches what a keystroke dispatches.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { MemoryRouter, Route } from '@solidjs/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrashPage } from '@/solid/pages/Trash';

vi.mock('@/solid/web/session', () => ({ useSession: () => ({ session: () => ({ user: { id: 'usr_1', email: 'owner@example.com' } }) }) }));

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
    render(() => <MemoryRouter><Route path="*" component={TrashPage} /></MemoryRouter>);

    const table = await screen.findByRole('table');
    await waitFor(() => expect(table).toHaveTextContent('Quarterly Review'));
    expect(table).toHaveTextContent('Quarterly Review');
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
