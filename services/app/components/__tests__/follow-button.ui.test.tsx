/**
 * FOLLOW on a public profile: the count for everyone; a signed-in click asks
 * the follow door and renders its answer; an anonymous reader is sent to
 * /login and the door is never asked.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { FollowButton } from '@/components/FollowButton';

const calls: Array<{ url: string; method: string; credentials: string | undefined }> = [];
let answer: { following: boolean; count: number };
beforeEach(() => {
  calls.length = 0;
  answer = { following: true, count: 8 };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', credentials: init?.credentials });
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
/** Set by the case that stands in for `window.location`; nothing else touches it. */
let restoreLocation: (() => void) | null = null;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); restoreLocation?.(); restoreLocation = null; });

describe('FollowButton', () => {
  it('a signed-in viewer sees the count, follows through the door, renders its answer, then unfollows', async () => {
    render(<MemoryRouter><FollowButton userId="usr_a" following={false} count={7} signedIn /></MemoryRouter>);
    const button = screen.getByRole('button', { name: /^follow$/i });
    expect(button.textContent).toContain('7');
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: /^unfollow$/i })).toBeTruthy());
    expect(calls).toEqual([{ url: '/api/users/usr_a/follow', method: 'POST', credentials: 'same-origin' }]);
    expect(screen.getByRole('button', { name: /^unfollow$/i }).textContent).toContain('8');
    answer = { following: false, count: 7 };
    fireEvent.click(screen.getByRole('button', { name: /^unfollow$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^follow$/i })).toBeTruthy());
    expect(calls[1]).toEqual({ url: '/api/users/usr_a/follow', method: 'DELETE', credentials: 'same-origin' });
  });
  /**
   * A GUEST is the case neither of the others covers: it holds a credential, so
   * the page draws the BUTTON, and the door still refuses it by name. The
   * answer has to be the same place the anonymous link points, or a guest press
   * is a click that silently does nothing.
   */
  it('a guest whose press is refused lands on /login, returning to this profile', async () => {
    window.history.replaceState(null, '', '/@sam?tab=stars');
    // The whole location is stood in for (jsdom's `assign` is not replaceable
    // on its own) and PUT BACK afterwards: the anonymous case below reads the
    // real one, and a clobbered location would make its pass an accident.
    const assign = vi.fn();
    const real = window.location;
    Object.defineProperty(window, 'location', { value: { ...real, pathname: '/@sam', search: '?tab=stars', hash: '', assign }, configurable: true, writable: true });
    restoreLocation = () => Object.defineProperty(window, 'location', { value: real, configurable: true, writable: true });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'sign_in_required' }), { status: 401, headers: { 'content-type': 'application/json' } })));
    render(<MemoryRouter><FollowButton userId="usr_a" following={false} count={7} signedIn /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /^follow$/i }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`/login?callbackUrl=${encodeURIComponent('/@sam?tab=stars')}`));
    // The count is untouched: a refusal changed nothing about who follows whom.
    expect(screen.getByRole('button', { name: /^follow$/i }).textContent).toContain('7');
  });
  it('an anonymous viewer sees the count and a link to /login that returns here; the door is never asked', async () => {
    window.history.replaceState(null, '', '/@sam?tab=stars');
    render(<MemoryRouter><FollowButton userId="usr_a" following={false} count={7} signedIn={false} /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /follow/i });
    await waitFor(() => expect(link.getAttribute('href')).toBe(`/login?callbackUrl=${encodeURIComponent('/@sam?tab=stars')}`));
    window.history.replaceState(null, '', '/');
    expect(link.textContent).toContain('7');
    expect(calls).toEqual([]);
  });
});
