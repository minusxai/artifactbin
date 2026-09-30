/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClaimBanner from '@/solid/components/ClaimBanner';
import { REFRESH_EVENT } from '@/web/page-data-events';

type Offer = { tokenId: string; titles: string[]; artifacts: number };
let offers: Offer[];
let failures: string[];
let rejectFailures: string[];
let claimed: string[];
let rejected: string[];
let refresh = vi.fn<() => void>();
const onRefresh = () => { refresh(); };
const open = () => render(() => <ClaimBanner />);
const banner = () => screen.findByLabelText('Unclaimed drafts');

beforeEach(() => {
  offers = []; failures = []; rejectFailures = []; claimed = []; rejected = [];
  refresh = vi.fn<() => void>(); window.addEventListener(REFRESH_EVENT, onRefresh);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/claimable')) return Response.json({ claimable: offers });
    const tokenId = JSON.parse(String(init?.body ?? '{}')).tokenId as string;
    if (url.endsWith('/claim')) { claimed.push(tokenId); return failures.includes(tokenId) ? Response.json({ error: 'not_found' }, { status: 404 }) : Response.json({ ok: true, claimedArtifacts: 1 }); }
    if (url.endsWith('/reject')) { rejected.push(tokenId); return rejectFailures.includes(tokenId) ? Response.json({ error: 'not_found' }, { status: 404 }) : new Response(null, { status: 204 }); }
    return Response.json({});
  }));
});
afterEach(() => { cleanup(); window.removeEventListener(REFRESH_EVENT, onRefresh); vi.unstubAllGlobals(); });

describe('claim offers', () => {
  it('renders nothing when the server has nothing to offer', async () => {
    open(); await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByLabelText('Unclaimed drafts')).toBeNull();
  });
  it('renders nothing when everything held is already claimed', async () => {
    offers = []; open(); await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByLabelText('Unclaimed drafts')).toBeNull();
  });
  it('renders nothing when lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 500 })));
    open(); await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByLabelText('Unclaimed drafts')).toBeNull();
  });
  it('names found drafts', async () => {
    offers = [{ tokenId: 'tok_a', titles: ['Q3 Revenue', 'Sales deck'], artifacts: 2 }]; open();
    expect(await banner()).toHaveTextContent('Q3 Revenue');
    expect(screen.getByLabelText('Unclaimed drafts')).toHaveTextContent('Sales deck');
  });
  it('ticks everything by default', async () => {
    offers = [{ tokenId: 'tok_a', titles: ['Q3 Revenue'], artifacts: 1 }]; open(); await banner();
    expect(screen.getByLabelText('Claim Q3 Revenue')).toBeChecked();
  });
  it('names a session with no published title', async () => {
    offers = [{ tokenId: 'tok_a', titles: [], artifacts: 0 }]; open();
    expect(await banner()).toHaveTextContent(/session|draft|browser/i);
  });
});

describe('claiming', () => {
  beforeEach(() => { offers = [{ tokenId: 'tok_a', titles: ['Q3 Revenue'], artifacts: 1 }, { tokenId: 'tok_b', titles: ['Sales deck'], artifacts: 1 }]; });
  it('claims every ticked token', async () => { open(); await banner(); fireEvent.click(screen.getByLabelText('Add to my account')); await waitFor(() => expect(claimed.sort()).toEqual(['tok_a', 'tok_b'])); });
  it('never claims an unticked one', async () => { open(); await banner(); fireEvent.click(screen.getByLabelText('Claim Sales deck')); fireEvent.click(screen.getByLabelText('Add to my account')); await waitFor(() => expect(claimed).toEqual(['tok_a'])); });
  it('refreshes the workspace', async () => { open(); await banner(); fireEvent.click(screen.getByLabelText('Add to my account')); await waitFor(() => expect(refresh).toHaveBeenCalled()); });
  it('keeps token credentials afterwards', async () => { open(); await banner(); fireEvent.click(screen.getByLabelText('Add to my account')); await waitFor(() => expect(refresh).toHaveBeenCalled()); expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false); });
  it('reports partial failure', async () => { failures = ['tok_b']; open(); await banner(); fireEvent.click(screen.getByLabelText('Add to my account')); expect(await screen.findByLabelText('Claim result')).toHaveTextContent(/could not|failed|couldn/i); });
  it('does nothing when everything is unticked', async () => { open(); await banner(); fireEvent.click(screen.getByLabelText('Claim Q3 Revenue')); fireEvent.click(screen.getByLabelText('Claim Sales deck')); fireEvent.click(screen.getByLabelText('Add to my account')); expect(claimed).toEqual([]); expect(refresh).not.toHaveBeenCalled(); });
});

describe('rejecting offers', () => {
  beforeEach(() => { offers = [{ tokenId: 'tok_a', titles: ['Alpha draft'], artifacts: 1 }, { tokenId: 'tok_b', titles: ['Beta draft'], artifacts: 1 }]; });
  it('posts the id and removes only that offer', async () => { open(); await banner(); fireEvent.click(screen.getByLabelText('Reject tok_a')); expect(rejected).toEqual([]); fireEvent.click(screen.getByLabelText('Confirm reject')); await waitFor(() => expect(screen.queryByText('Alpha draft')).toBeNull()); expect(rejected).toEqual(['tok_a']); expect(screen.getByText('Beta draft')).toBeInTheDocument(); expect(refresh).not.toHaveBeenCalled(); });
  it('lets a user decline the confirmation', async () => { open(); await banner(); fireEvent.click(screen.getByLabelText('Reject tok_a')); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(rejected).toEqual([]); expect(screen.getByText('Alpha draft')).toBeInTheDocument(); });
  it('retains the offer and reports a failed reject', async () => { rejectFailures = ['tok_b']; open(); await banner(); fireEvent.click(screen.getByLabelText('Reject tok_b')); fireEvent.click(screen.getByLabelText('Confirm reject')); expect(await screen.findByText(/could not reject/i)).toBeInTheDocument(); expect(screen.getByText('Beta draft')).toBeInTheDocument(); });
  it('removes the banner after rejecting its last offer', async () => { open(); await banner(); fireEvent.click(screen.getByLabelText('Reject tok_a')); fireEvent.click(screen.getByLabelText('Confirm reject')); await waitFor(() => expect(screen.queryByText('Alpha draft')).toBeNull()); fireEvent.click(screen.getByLabelText('Reject tok_b')); fireEvent.click(screen.getByLabelText('Confirm reject')); await waitFor(() => expect(screen.queryByLabelText('Unclaimed drafts')).toBeNull()); });
});
