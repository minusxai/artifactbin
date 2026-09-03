/**
 * "refresh external images" — the owner's half of `refresh_asset`.
 *
 * The URL cache is global and first-cached wins, so when the picture behind a
 * URL changes there has to be a way to say so that does not involve republishing
 * a document that is already correct. The agent has the tool; this is the row a
 * person clicks, over the same pipeline (`/api/my/artifacts/:id/assets/refresh`).
 *
 * Two things it must get right, both of them precedents the fork row set: it is
 * OWNER chrome (refreshing changes bytes every reader of every document naming
 * that URL will see), and it SAYS WHAT HAPPENED where it was asked — "nothing
 * changed" is the answer people most need, and a row that only spun would leave
 * them republishing to be sure.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RefreshAssets from '../RefreshAssets';

const calls: Array<{ url: string; init?: RequestInit }> = [];
const answering = (status: number, body: unknown) => vi.fn(async (url: string, init?: RequestInit) => {
  calls.push({ url, init });
  return { ok: status === 200, status, json: async () => body } as Response;
}) as unknown as typeof fetch;

beforeEach(() => { calls.length = 0; });
afterEach(() => vi.unstubAllGlobals());

describe('the refresh row', () => {
  it('posts to the browser door and names what moved', async () => {
    vi.stubGlobal('fetch', answering(200, { refreshed: ['https://a.example/one.png'], unchanged: [], failed: [] }));
    render(<RefreshAssets id="story1" variant="menu" />);

    const row = screen.getByLabelText('Refresh external images');
    expect(row).toHaveTextContent('refresh external images');
    fireEvent.click(row);

    await waitFor(() => expect(screen.getByLabelText('Refresh result')).toHaveTextContent('1 refreshed'));
    expect(calls[0].url).toBe('/api/my/artifacts/story1/assets/refresh');
    expect(calls[0].init?.method).toBe('POST');
  });

  it('says so when nothing changed — the answer that stops a needless republish', async () => {
    vi.stubGlobal('fetch', answering(200, { refreshed: [], unchanged: ['https://a.example/one.png'], failed: [] }));
    render(<RefreshAssets id="story1" variant="menu" />);
    fireEvent.click(screen.getByLabelText('Refresh external images'));
    await waitFor(() => expect(screen.getByLabelText('Refresh result')).toHaveTextContent('already up to date'));
  });

  it('names a url that failed, and why', async () => {
    vi.stubGlobal('fetch', answering(200, {
      refreshed: [], unchanged: [], failed: [{ code: 'bad_status', url: 'https://a.example/gone.png', fix: 'check it is public and still there' }],
    }));
    render(<RefreshAssets id="story1" variant="menu" />);
    fireEvent.click(screen.getByLabelText('Refresh external images'));
    await waitFor(() => expect(screen.getByLabelText('Refresh result')).toHaveTextContent('gone.png'));
    expect(screen.getByLabelText('Refresh result')).toHaveTextContent('check it is public');
  });

  it('does not fire twice on a double click', async () => {
    vi.stubGlobal('fetch', answering(200, { refreshed: [], unchanged: [], failed: [] }));
    render(<RefreshAssets id="story1" variant="menu" />);
    const row = screen.getByLabelText('Refresh external images');
    fireEvent.click(row);
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByLabelText('Refresh result')).toBeInTheDocument());
    expect(calls).toHaveLength(1);
  });
});
