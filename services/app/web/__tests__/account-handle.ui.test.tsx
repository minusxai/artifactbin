/**
 * THE HANDLE FIELD SHOWS THE HANDLE — even though the page learns it late.
 *
 * Under the old server-rendered page the username was in the first render, so
 * a form seeded with `useState(username)` was seeded correctly. The SPA renders
 * FIRST and fetches after, so the card mounted with `null`, kept that as its
 * state, and the account page showed an EMPTY handle box to someone who has a
 * handle — measured in a real browser against the built server: the row in the
 * database said `davidgraeber99_do01` and the field said nothing.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AccountPage } from '@/web/pages/Account';

vi.mock('@/web/session', () => ({ useSession: () => ({ session: { user: { id: 'usr_1', email: 'a@example.com' } } }) }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/page/account')) {
      // Late, as a network answer is.
      await new Promise((r) => setTimeout(r, 5));
      return new Response(JSON.stringify({ username: 'davidgraeber99_do01', viewsChart: null }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the account page', () => {
  it('fills the handle field once the answer arrives', async () => {
    render(<MemoryRouter><AccountPage /></MemoryRouter>);
    await waitFor(() => {
      expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('davidgraeber99_do01');
    });
  });

  it('keeps account utilities together by offering data upload beside token management', () => {
    render(<MemoryRouter><AccountPage /></MemoryRouter>);
    expect(screen.getByText('Add data')).toBeInTheDocument();
    expect(screen.getByLabelText('Upload a CSV')).toBeInTheDocument();
    expect(screen.getByLabelText('Token to claim')).toBeInTheDocument();
  });
});
