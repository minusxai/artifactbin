/**
 * ONE 404, EVERYWHERE. The glitch page (the big "404" graphic that was
 * app/not-found.tsx before the SPA split) is the ONLY not-found body the app
 * shows: the SPA's own catch-all, an artifact the viewer may not read, and a
 * profile that resolves to nothing must all render the same page — the split
 * left three different shapes behind (a bare "not found" line on two pages,
 * Hono's plain-text default on root typos), and a miss stopped looking like
 * the product.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { NotFoundPage } from '@/web/pages/NotFound';
import { ArtifactPage } from '@/web/pages/Artifact';
import { ProfilePage } from '@/web/pages/Profile';

const state: { user: { id: string; email: string } | null } = { user: null };
vi.mock('@/web/session', () => ({ useSession: () => ({ session: { user: state.user } }) }));

beforeEach(() => {
  state.user = null;
  // Every page data call misses: what these tests assert is the miss's face.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** The glitch page, by what makes it it: the 404 graphic and the way back. */
const expectGlitch404 = async () => {
  await waitFor(() => expect(screen.getByLabelText('Not found')).toBeTruthy());
  expect(screen.getByText('404').className).toContain('nf-glitch');
  expect(screen.getByLabelText('Back to artifacts')).toBeTruthy();
};

describe('the one 404 page', () => {
  it('is the glitch page, and offers a stranger the sign-in door', async () => {
    render(<MemoryRouter><NotFoundPage /></MemoryRouter>);
    await expectGlitch404();
    expect(screen.getByLabelText('Sign in')).toBeTruthy();
  });
  it('offers no sign-in door when already signed in', async () => {
    state.user = { id: 'usr_x', email: 'x@x.io' };
    render(<MemoryRouter><NotFoundPage /></MemoryRouter>);
    expect(screen.queryByLabelText('Sign in')).toBeNull();
  });
});

describe('every miss wears it', () => {
  it('an artifact the viewer may not read', async () => {
    render(<MemoryRouter initialEntries={['/a/nope00']}><Routes><Route path="/a/:id" element={<ArtifactPage />} /></Routes></MemoryRouter>);
    await expectGlitch404();
  });
  it('a profile that resolves to nothing', async () => {
    render(<MemoryRouter initialEntries={['/@nobody']}><Routes><Route path="/:user/*" element={<ProfilePage />} /></Routes></MemoryRouter>);
    await expectGlitch404();
  });
  it('a root typo — no @, no fetch, straight to the page', async () => {
    render(<MemoryRouter initialEntries={['/hihi']}><Routes><Route path="/:user/*" element={<ProfilePage />} /></Routes></MemoryRouter>);
    await expectGlitch404();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
