/**
 * THE HANDLE FIELD SHOWS THE HANDLE — even though the page learns it late.
 *
 * The page renders FIRST and fetches after, so a card that seeded its state
 * once at mount would keep the `null` it mounted with and show an EMPTY handle
 * box to someone who has a handle.
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
      return new Response(JSON.stringify({ username: 'davidgraeber99_do01', image: '/api/users/usr_1/avatar?v=abc123' }), { status: 200 });
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

  it('carries the same picture control the welcome page does, with a way to take it back off', async () => {
    const { container } = render(<MemoryRouter><AccountPage /></MemoryRouter>);
    expect(await screen.findByLabelText('Change picture')).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/users/usr_1/avatar?v=abc123');
    });
    expect(screen.getByRole('button', { name: 'Remove picture' })).toBeInTheDocument();
  });

  it('keeps account utilities together by offering data upload beside connection management', () => {
    render(<MemoryRouter><AccountPage /></MemoryRouter>);
    expect(screen.getByText('Add data')).toBeInTheDocument();
    expect(screen.getByLabelText('Upload a CSV')).toBeInTheDocument();
    // Connections are LISTED and revoked here; nothing on the page asks a
    // person for a credential, because there is none for them to hold.
    expect(screen.queryByLabelText('Token to claim')).toBeNull();
    expect(screen.getByText(/afbin CLI connection/)).toBeInTheDocument();
  });
});
