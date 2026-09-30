/* @jsxImportSource solid-js */
/**
 * Behaviour the React test does not pin but the Solid port is most likely to get wrong: derived
 * values that must stay reactive (pagination), the signed-out redirect through the Solid router, and
 * the child-wrapping tooltip (Radix `asChild` in React) portalling out of the table to the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrashPage } from '@/solid/pages/Trash';

const auth = vi.hoisted(() => ({ user: { id: 'usr_1', email: 'owner@example.com' } as { id: string; email: string } | null }));
vi.mock('@/solid/lib/session', () => ({ useSession: () => ({ session: () => ({ user: auth.user, kind: auth.user ? 'account' : 'none', onboarded: true }) }) }));

const many = Array.from({ length: 12 }, (_, i) => ({ id: `doc_${i + 1}`, title: `Doc ${String(i + 1).padStart(2, '0')}`, format: 'markup', version: 1, deleted_at: '2026-09-05T06:00:00.000Z' }));

beforeEach(() => {
  auth.user = { id: 'usr_1', email: 'owner@example.com' };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url) === '/api/page/trash'
    ? new Response(JSON.stringify({ files: many }), { status: 200 })
    : new Response('{}', { status: 404 })));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('trash (Solid hazards)', () => {
  it('pages through the rows and keeps the range, buttons and search in step', async () => {
    render(() => <MemoryRouter><Route path="*" component={TrashPage} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Page range')).toHaveTextContent('1-10 of 12'));
    expect(screen.getByLabelText('Previous page')).toBeDisabled();
    expect(screen.getByRole('table')).toHaveTextContent('Doc 10');
    expect(screen.getByRole('table')).not.toHaveTextContent('Doc 11');

    fireEvent.click(screen.getByLabelText('Next page'));
    expect(screen.getByLabelText('Page range')).toHaveTextContent('11-12 of 12');
    expect(screen.getByLabelText('Next page')).toBeDisabled();
    expect(screen.getByRole('table')).toHaveTextContent('Doc 12');
    expect(screen.getByRole('table')).not.toHaveTextContent('Doc 01');

    // A search resets to the first page and hides the pager once everything fits.
    fireEvent.input(screen.getByLabelText('Search trash'), { target: { value: 'Doc 0' } });
    expect(screen.getByRole('table')).toHaveTextContent('Doc 01');
    expect(screen.queryByLabelText('Page range')).not.toBeInTheDocument();
    expect(screen.getByText('9 / 12')).toBeInTheDocument();
  });

  it('portals a trigger tooltip to the body and describes the trigger while open', async () => {
    render(() => <MemoryRouter><Route path="*" component={TrashPage} /></MemoryRouter>);
    const next = await screen.findByLabelText('Next page');
    fireEvent.focus(next);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('next');
    expect(screen.getByRole('table').contains(tip)).toBe(false);
    expect(next).toHaveAttribute('aria-describedby', tip.id);
    expect(next).toHaveAttribute('data-state', 'instant-open');
    fireEvent.blur(next);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(next).not.toHaveAttribute('aria-describedby');
  });

  it('sends a signed-out visitor to login and back', async () => {
    auth.user = null;
    const history = createMemoryHistory();
    history.set({ value: '/trash', replace: true });
    render(() => <MemoryRouter history={history}>
      <Route path="/trash" component={TrashPage} />
      <Route path="/login" component={() => <p>login page</p>} />
    </MemoryRouter>);
    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(history.get()).toBe('/login?callbackUrl=/trash');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
