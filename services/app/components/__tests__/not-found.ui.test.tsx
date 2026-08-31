/**
 * The 404 page.
 *
 * With no app/not-found.tsx, Next serves its built-in fallback, which injects
 * `body{color:#000;background:#fff;margin:0}` — a `background` shorthand that
 * wipes the dot-grid `background-image` every other page is painted on. A miss
 * therefore landed on a bare white (or, in dark OS mode, bare black) Helvetica
 * page that looks like a different product. Owning the route is the fix; these
 * guard that it stays owned and never repaints the body itself.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { NotFoundPage } from '@/web/pages/NotFound';

const SRC = path.resolve(__dirname, '../../web/pages/NotFound.tsx');

describe('the 404 page', () => {
  it('renders our own page rather than a framework fallback', () => {
    render(<NotFoundPage />);
    expect(screen.getByRole('main').textContent).toContain('404');
  });

  it('offers a way back to the artifact list', () => {
    render(<NotFoundPage />);
    expect(screen.getByLabelText('Back to artifacts')).toHaveAttribute('href', '/');
  });

  it('admits the miss may be an access denial', () => {
    // The ACL answers a uniform 404 for "gone" and "not yours to read" alike —
    // this page is where that ambiguity is explained.
    render(<NotFoundPage />);
    expect(screen.getByRole('main').textContent?.toLowerCase()).toContain('access');
  });

  it('routes a signed-out viewer to login', async () => {
    const { SessionProvider } = await import('@/web/session');
    const signedOut = { user: null, kind: 'none', stats: null, mixpanel: { token: null, host: '' } };
    const withSession = (s: typeof signedOut) => {
      vi.stubGlobal('fetch', (async () => new Response(JSON.stringify(s), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch);
      return <SessionProvider><NotFoundPage /></SessionProvider>;
    };
    render(withSession(signedOut));
    expect(await screen.findByLabelText('Sign in')).toHaveAttribute('href', '/login');
    vi.unstubAllGlobals();
  });

  it('paints nothing itself, so the dot-grid body shows through', () => {
    const src = readFileSync(SRC, 'utf8');
    // Hardcoded ink or a background of its own is exactly how the fallback broke
    // the grid — the palette lives in globals.css and must stay there.
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\bbackground(-color|-image)?\s*:/);
  });
});
