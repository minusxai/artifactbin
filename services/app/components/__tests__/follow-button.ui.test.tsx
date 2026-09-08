/**
 * FOLLOW on a public profile: the count for everyone; a signed-in click asks
 * the follow door and renders its answer; an anonymous reader is sent to
 * /login and the door is never asked.
 *
 * Seeded RED by the orchestrator.
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
  it('an anonymous viewer sees the count and a link to /login; the door is never asked', () => {
    render(<MemoryRouter><FollowButton userId="usr_a" following={false} count={7} signedIn={false} /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /follow/i });
    expect(link.getAttribute('href')).toBe('/login');
    expect(link.textContent).toContain('7');
    expect(calls).toEqual([]);
  });
});
