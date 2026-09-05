/**
 * THE HEART: the count for everyone; a signed-in click asks the like door and
 * renders its answer; an anonymous reader is sent to /login and the door is
 * never asked.
 *
 * Seeded RED by the orchestrator.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { LikeButton } from '@/components/LikeButton';

const calls: Array<{ url: string; method: string; credentials: string | undefined }> = [];
let answer: { liked: boolean; count: number };
beforeEach(() => {
  calls.length = 0;
  answer = { liked: true, count: 3 };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', credentials: init?.credentials });
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('LikeButton', () => {
  it('a signed-in reader sees the count, likes through the door, and renders the door\'s answer — then unlikes', async () => {
    render(<MemoryRouter><LikeButton artifactId="art0a1" liked={false} count={2} signedIn /></MemoryRouter>);
    const button = screen.getByRole('button', { name: /^like$/i });
    expect(button.textContent).toContain('2');
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: /^unlike$/i })).toBeTruthy());
    expect(calls).toEqual([{ url: '/api/my/artifacts/art0a1/like', method: 'POST', credentials: 'same-origin' }]);
    expect(screen.getByRole('button', { name: /^unlike$/i }).textContent).toContain('3');
    answer = { liked: false, count: 2 };
    fireEvent.click(screen.getByRole('button', { name: /^unlike$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^like$/i })).toBeTruthy());
    expect(calls[1]).toEqual({ url: '/api/my/artifacts/art0a1/like', method: 'DELETE', credentials: 'same-origin' });
    expect(screen.getByRole('button', { name: /^like$/i }).textContent).toContain('2');
  });
  it('a door that refuses leaves the state as it was', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"forbidden"}', { status: 403 })));
    render(<MemoryRouter><LikeButton artifactId="art0a1" liked={false} count={2} signedIn /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /^like$/i }));
    await waitFor(() => expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1));
    expect(screen.getByRole('button', { name: /^like$/i }).textContent).toContain('2');
  });
  it('an anonymous reader sees the count and a link to /login; the door is never asked', () => {
    render(<MemoryRouter><LikeButton artifactId="art0a1" liked={false} count={5} signedIn={false} /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /like/i });
    expect(link.getAttribute('href')).toBe('/login');
    expect(link.textContent).toContain('5');
    expect(screen.queryByRole('button')).toBeNull();
    expect(calls).toEqual([]);
  });
});
