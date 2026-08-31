/**
 * "These drafts were made from this browser — add them to your account?"
 *
 * The banner exists so nobody has to paste a credential their own browser is
 * already holding. It transfers OWNERSHIP, with no undo, so the rules it must
 * keep are about honesty rather than convenience:
 *
 *   - name what it found, so a shared-browser user recognises what ISN'T theirs
 *   - never claim anything unticked
 *   - never appear at all when there is nothing to offer (no empty chrome)
 *   - tell the truth when part of the batch fails
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const refresh = vi.fn();
vi.mock('@/lib/navigation', () => ({ useRouter: () => ({ refresh, push: () => {}, replace: () => {}, back: () => {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

import ClaimBanner from '../ClaimBanner';

/**
 * What the browser holds is now its httpOnly cookie, which this component
 * cannot read and does not name: it asks the server with an EMPTY request and
 * claims by token ID. So there is nothing to seed in localStorage here — the
 * `claimable` fixture IS what the browser holds.
 */
let claimed: string[];
let claimable: Array<{ tokenId: string; titles: string[]; artifacts: number }>;
let failFor: string[];

beforeEach(() => {
  localStorage.clear();
  refresh.mockClear();
  claimed = [];
  failFor = [];
  claimable = [];
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/api/tokens/claimable')) {
      return { ok: true, status: 200, json: async () => ({ claimable }) };
    }
    if (u.endsWith('/api/tokens/claim')) {
      const token = JSON.parse(String(init?.body ?? '{}')).tokenId as string;
      claimed.push(token);
      if (failFor.includes(token)) return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, claimedArtifacts: 1 }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }) as unknown as typeof fetch;
});

const banner = () => render(<ClaimBanner />);
const findBanner = () => screen.findByLabelText('Unclaimed drafts');

describe('when it stays out of the way', () => {
  it('renders nothing when the server has nothing to offer', async () => {
    // The page cannot know what the cookie holds, so it always asks — one cheap
    // request — and stays silent on an empty answer.
    banner();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByLabelText('Unclaimed drafts')).toBeNull();
  });

  it('renders nothing when everything held is already claimed', async () => {
    claimable = [];
    banner();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByLabelText('Unclaimed drafts')).toBeNull();
  });

  it('renders nothing when the lookup fails — a broken probe is not a prompt', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    banner();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByLabelText('Unclaimed drafts')).toBeNull();
  });
});

describe('what it shows', () => {
  beforeEach(() => {
    claimable = [{ tokenId: 'tok_aaa', titles: ['Q3 Revenue', 'Sales deck'], artifacts: 2 }];
  });

  it('names the drafts it found', async () => {
    banner();
    const el = await findBanner();
    expect(el.textContent).toContain('Q3 Revenue');
    expect(el.textContent).toContain('Sales deck');
  });

  it('ticks everything by default — the common case is one click', async () => {
    banner();
    await findBanner();
    expect((screen.getByLabelText('Claim Q3 Revenue') as HTMLInputElement).checked).toBe(true);
  });

  it('names a token that published nothing without pretending it has titles', async () => {
    claimable = [{ tokenId: 'tok_aaa', titles: [], artifacts: 0 }];
    banner();
    expect((await findBanner()).textContent).toMatch(/session|draft|browser/i);
  });
});

describe('claiming', () => {
  beforeEach(() => {
    claimable = [
      { tokenId: 'tok_aaa', titles: ['Q3 Revenue'], artifacts: 1 },
      { tokenId: 'tok_bbb', titles: ['Sales deck'], artifacts: 1 },
    ];
  });

  it('claims every ticked token', async () => {
    banner();
    await findBanner();
    fireEvent.click(screen.getByLabelText('Add to my account'));
    await waitFor(() => expect(claimed.sort()).toEqual(['tok_aaa', 'tok_bbb']));
  });

  it('NEVER claims an unticked one', async () => {
    banner();
    await findBanner();
    fireEvent.click(screen.getByLabelText('Claim Sales deck')); // untick
    fireEvent.click(screen.getByLabelText('Add to my account'));
    await waitFor(() => expect(claimed).toEqual(['tok_aaa']));
    expect(claimed).not.toContain('tok_bbb');
  });

  it('refreshes the page so the new artifacts appear in the list', async () => {
    banner();
    await findBanner();
    fireEvent.click(screen.getByLabelText('Add to my account'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('KEEPS the tokens afterwards — claiming changes ownership, not validity', async () => {
    // They are still this browser's editing credential for those documents, and
    // the cookie is the server's to clear, not this component's: it must never
    // ask for one to be dropped.
    banner();
    await findBanner();
    fireEvent.click(screen.getByLabelText('Add to my account'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
  });

  it('reports partial failure instead of claiming success', async () => {
    failFor = ['tok_bbb'];
    banner();
    await findBanner();
    fireEvent.click(screen.getByLabelText('Add to my account'));
    const status = await screen.findByLabelText('Claim result');
    expect(status.textContent).toMatch(/1/);
    expect(status.textContent).toMatch(/could not|failed|couldn/i);
  });

  it('does nothing when everything is unticked', async () => {
    banner();
    await findBanner();
    fireEvent.click(screen.getByLabelText('Claim Q3 Revenue'));
    fireEvent.click(screen.getByLabelText('Claim Sales deck'));
    fireEvent.click(screen.getByLabelText('Add to my account'));
    await waitFor(() => expect(refresh).not.toHaveBeenCalled());
    expect(claimed).toEqual([]);
  });
});
