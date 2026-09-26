/**
 * THE PROFILE'S SOCIAL HEADER, as X draws it: both counts for everyone; a
 * "Follows you" badge and "Follow back" when they follow you; "Following" once
 * you do; and the people you follow who follow them. A signed-in click asks the
 * follow door and renders its answer; an anonymous reader is sent to /login.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { ProfileSocialHeader } from '@/components/ProfileSocial';
import type { ProfileRelation } from '@/lib/profile-social';

const calls: Array<{ url: string; method: string; credentials: string | undefined }> = [];
let answer: { following: boolean; count: number };
beforeEach(() => {
  calls.length = 0;
  answer = { following: true, count: 5 };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', credentials: init?.credentials });
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
/** Set by the case that stands in for `window.location`; nothing else touches it. */
let restoreLocation: (() => void) | null = null;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); restoreLocation?.(); restoreLocation = null; });

const person = (username: string) => ({ id: `usr_${username}`, username, image: null });
const relation = (over: Partial<ProfileRelation> = {}): ProfileRelation => ({ youFollow: false, followsYou: false, known: [], knownTotal: 0, ...over });
const header = (props: Partial<Parameters<typeof ProfileSocialHeader>[0]>) =>
  render(<MemoryRouter><ProfileSocialHeader userId="usr_sam" signedIn social={{ followers: 4, following: 2 }} {...props} /></MemoryRouter>);
const stat = (name: RegExp) => screen.getByText(name).closest('[data-stat]')!;

describe('ProfileSocialHeader', () => {
  it('shows the owner both counts and nothing to press', () => {
    header({});
    expect(stat(/^Following$/).textContent).toBe('2 Following');
    expect(stat(/^Followers$/).textContent).toBe('4 Followers');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Follows you')).toBeNull();
  });

  it('says "Follows you", offers Follow back, becomes Following, and the follower count follows the answer', async () => {
    header({ social: { followers: 4, following: 2, relation: relation({ followsYou: true }) } });
    expect(screen.getByText('Follows you')).toBeTruthy();
    const back = screen.getByRole('button', { name: 'Follow back' });
    expect(back.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(back);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Following' }).getAttribute('aria-pressed')).toBe('true'));
    expect(calls).toEqual([{ url: '/api/users/usr_sam/follow', method: 'POST', credentials: 'same-origin' }]);
    expect(stat(/^Followers$/).textContent).toBe('5 Followers');
    // The pressed state shows Unfollow on hover, as X does; the name stays the state.
    expect(within(screen.getByRole('button', { name: 'Following' })).getByText('Unfollow', { exact: true })).toBeTruthy();
    answer = { following: false, count: 4 };
    fireEvent.click(screen.getByRole('button', { name: 'Following' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Follow back' })).toBeTruthy());
    expect(calls[1]).toEqual({ url: '/api/users/usr_sam/follow', method: 'DELETE', credentials: 'same-origin' });
    expect(stat(/^Followers$/).textContent).toBe('4 Followers');
  });

  it('offers plain Follow to a stranger who is not followed back', () => {
    header({ social: { followers: 4, following: 2, relation: relation() } });
    expect(screen.getByRole('button', { name: 'Follow' })).toBeTruthy();
    expect(screen.queryByText('Follows you')).toBeNull();
  });

  it('names up to three followers you know, links them, and counts the rest', () => {
    header({ social: { followers: 9, following: 2, relation: relation({ known: [person('ann'), person('bob'), person('cat')], knownTotal: 5 }) } });
    const line = screen.getByText(/^Followed by/).closest('p')!;
    expect(line.textContent).toBe('Followed by ann, bob, cat and 2 others you follow');
    expect(within(line).getByRole('link', { name: 'ann' }).getAttribute('href')).toBe('/@ann');
  });

  it('says it plainly for one, two and three known followers, and not at all for none', () => {
    const says = (names: string[]) => {
      cleanup();
      header({ social: { followers: 9, following: 2, relation: relation({ known: names.map(person), knownTotal: names.length }) } });
      return screen.queryByText(/^Followed by/)?.closest('p')?.textContent ?? null;
    };
    expect(says([])).toBeNull();
    expect(says(['ann'])).toBe('Followed by ann');
    expect(says(['ann', 'bob'])).toBe('Followed by ann and bob');
    expect(says(['ann', 'bob', 'cat'])).toBe('Followed by ann, bob and cat');
    cleanup();
    header({ social: { followers: 9, following: 2, relation: relation({ known: [person('ann')], knownTotal: 2 }) } });
    expect(screen.getByText(/^Followed by/).closest('p')!.textContent).toBe('Followed by ann and 1 other you follow');
  });

  /**
   * A GUEST holds a credential, so the page draws the BUTTON, and the door
   * still refuses it by name. The answer has to be the same place the
   * anonymous link points, or a guest press silently does nothing.
   */
  it('a guest whose press is refused lands on /login, returning to this profile', async () => {
    window.history.replaceState(null, '', '/@sam?tab=stars');
    const assign = vi.fn();
    const real = window.location;
    Object.defineProperty(window, 'location', { value: { ...real, pathname: '/@sam', search: '?tab=stars', hash: '', assign }, configurable: true, writable: true });
    restoreLocation = () => Object.defineProperty(window, 'location', { value: real, configurable: true, writable: true });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'sign_in_required' }), { status: 401, headers: { 'content-type': 'application/json' } })));
    header({ social: { followers: 4, following: 2, relation: relation() } });
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`/login?callbackUrl=${encodeURIComponent('/@sam?tab=stars')}`));
    // A refusal changed nothing about who follows whom.
    expect(stat(/^Followers$/).textContent).toBe('4 Followers');
  });

  it('an anonymous viewer sees the counts and a Follow link to /login that returns here; the door is never asked', async () => {
    window.history.replaceState(null, '', '/@sam?tab=stars');
    header({ signedIn: false });
    const link = screen.getByRole('link', { name: 'Follow' });
    await waitFor(() => expect(link.getAttribute('href')).toBe(`/login?callbackUrl=${encodeURIComponent('/@sam?tab=stars')}`));
    window.history.replaceState(null, '', '/');
    expect(stat(/^Followers$/).textContent).toBe('4 Followers');
    expect(calls).toEqual([]);
  });
});
