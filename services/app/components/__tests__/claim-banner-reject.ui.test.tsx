/**
 * REJECT beside claim in the banner (tok-p2). Each offered token gets a "Reject <id>" control; it confirms
 * (a rejected token is gone for good), posts `{ tokenId }` to /api/tokens/reject, and on 204 the offer leaves the
 * list without a reload (the response already rewrote the cookie). A failed reject keeps the offer and says so.
 *
 * Seeded RED by the orchestrator; make it green without changing an expectation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const refresh = vi.fn();
vi.mock('@/lib/navigation', () => ({ useRouter: () => ({ refresh, push: () => {}, replace: () => {}, back: () => {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

import ClaimBanner from '../ClaimBanner';

let rejected: string[];
let failFor: string[];
const OFFERS = [
  { tokenId: 'tok_a', titles: ['Alpha draft'], artifacts: 1 },
  { tokenId: 'tok_b', titles: ['Beta draft'], artifacts: 1 },
];

beforeEach(() => {
  localStorage.clear();
  refresh.mockClear();
  rejected = [];
  failFor = [];
  window.confirm = () => true;
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/api/tokens/claimable')) return { ok: true, status: 200, json: async () => ({ claimable: OFFERS }) };
    if (u.endsWith('/api/tokens/reject')) {
      expect(init?.method).toBe('POST');
      const tokenId = JSON.parse(String(init?.body ?? '{}')).tokenId as string;
      rejected.push(tokenId);
      if (failFor.includes(tokenId)) return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) };
      return { ok: true, status: 204, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }) as unknown as typeof fetch;
});

describe('rejecting an offered token', () => {
  it('posts the id, and the offer leaves the list while the others stay', async () => {
    render(<ClaimBanner />);
    await screen.findByText('Alpha draft');
    fireEvent.click(await screen.findByLabelText('Reject tok_a'));
    await waitFor(() => expect(rejected).toEqual(['tok_a']));
    await waitFor(() => expect(screen.queryByText('Alpha draft')).toBeNull());
    expect(screen.getByText('Beta draft')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('asks before rejecting, and a declined confirm posts nothing', async () => {
    window.confirm = () => false;
    render(<ClaimBanner />);
    fireEvent.click(await screen.findByLabelText('Reject tok_a'));
    await new Promise((r) => setTimeout(r, 20));
    expect(rejected).toEqual([]);
    expect(screen.getByText('Alpha draft')).toBeTruthy();
  });

  it('a failed reject keeps the offer and says it could not reject', async () => {
    failFor = ['tok_b'];
    render(<ClaimBanner />);
    fireEvent.click(await screen.findByLabelText('Reject tok_b'));
    await waitFor(() => expect(rejected).toEqual(['tok_b']));
    expect(await screen.findByText(/could not reject/i)).toBeTruthy();
    expect(screen.getByText('Beta draft')).toBeTruthy();
  });

  it('rejecting the last offer takes the banner away', async () => {
    render(<ClaimBanner />);
    fireEvent.click(await screen.findByLabelText('Reject tok_a'));
    await waitFor(() => expect(screen.queryByText('Alpha draft')).toBeNull());
    fireEvent.click(await screen.findByLabelText('Reject tok_b'));
    await waitFor(() => expect(screen.queryByLabelText('Unclaimed drafts')).toBeNull());
  });
});
