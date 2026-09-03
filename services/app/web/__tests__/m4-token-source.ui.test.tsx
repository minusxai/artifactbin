/**
 * M4 — /tokens/new?source=<surface>.
 *
 * The human landed here because their agent had no token and sent them. That is the one moment they
 * will ever be receptive to "install the plugin and never do this again", and the page currently says
 * nothing. The token stays exactly as available as it was; the recommendation sits above it.
 *
 * Seeded RED by the orchestrator; make it green without changing an expectation.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { TokensNewPage } from '@/web/pages/TokensNew';
import { sourceSurface } from '@/components/GetStarted';

type Session = { user: { id: string; email: string | null } | null; kind: 'account' | 'anon' | 'none'; stats: null; mixpanel: { token: null; host: string } };
let session: Session;
vi.mock('@/web/session', () => ({ useSession: () => ({ session, reload: () => {} }) }));

beforeEach(() => {
  session = { user: null, kind: 'none', stats: null, mixpanel: { token: null, host: '' } };
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const at = (search: string) => render(
  <MemoryRouter initialEntries={[`/tokens/new${search}`]}><TokensNewPage /></MemoryRouter>,
);

describe('sourceSurface — a query string becomes a surface, or nothing', () => {
  it('reads a known surface', () => {
    expect(sourceSurface('?source=claude-code')).toBe('claude-code');
    expect(sourceSurface('?source=codex')).toBe('codex');
  });

  it('is null for anything it does not know, and never throws on user input', () => {
    for (const q of ['', '?', '?source=', '?source=nonsense', '?other=claude-code', '?source=%%%', '?source[]=x']) {
      expect(sourceSurface(q)).toBeNull();
    }
  });

  // A surface key is an EXACT key, the way `mx_surface` stores it. Odd casing is a string we do not
  // know, and the honest answer to "I do not know this" is the picker — not a guess dressed up as an
  // answer. It must still come back as null rather than as an exception.
  it('is null for odd casing, and for a query that is no query at all', () => {
    for (const q of ['?source=Claude-Code', '?source=CLAUDE-CODE', '?source=Codex', '?source= claude-code']) {
      expect(sourceSurface(q)).toBeNull();
    }
    for (const q of ['not-a-query-string', '?=claude-code', '?source=claude-code#frag', '&&&']) {
      expect(() => sourceSurface(q)).not.toThrow();
    }
  });

  it('reads the source out of a query that carries other things too', () => {
    expect(sourceSurface('?callbackUrl=%2Fa%2Fx&source=codex')).toBe('codex');
    expect(sourceSurface('source=opencode')).toBe('opencode');
  });
});

describe('the page', () => {
  it('opens on the named surface when an agent said where it runs', () => {
    at('?source=claude-code');
    expect(screen.getByText(/plugin marketplace add/i)).toBeInTheDocument();
  });

  it('still offers the token — the recommendation does not gate the mint', () => {
    at('?source=claude-code');
    expect(screen.getByRole('button', { name: /generate a token/i })).toBeInTheDocument();
  });

  // The card is a recommendation, not a toll gate: the human who came for a string still gets it in
  // the same number of clicks, with the same body and the same secret — and the recommendation is
  // still standing afterwards, because that is when they are deciding whether to come back here again.
  it('mints exactly as it always did while the recommendation is on screen', async () => {
    const secret = `mx_${'a'.repeat(43)}`;
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? 'null')) });
      if (String(url).endsWith('/api/tokens/anonymous')) {
        return new Response(JSON.stringify({ token: secret, expiresAt: '2026-09-01T00:00:00.000Z' }), { status: 201 });
      }
      return new Response(null, { status: 204 });
    }));
    at('?source=claude-code');
    expect(screen.getByText(/plugin marketplace add/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /generate a token/i }));
    expect(await screen.findByText(secret)).toBeInTheDocument();
    expect(calls[0]).toEqual({ url: '/api/tokens/anonymous', body: { expiresInHours: 6 } });
    expect(screen.getByText(/plugin marketplace add/i)).toBeInTheDocument();
  });

  it('opens on a different named surface — the card is the source, not a hardcoded one', () => {
    at('?source=codex');
    expect(screen.getByRole('button', { name: 'Use in Codex CLI' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/interactive installer/i)).toBeInTheDocument();
    expect(screen.queryByText(/plugin marketplace add/i)).toBeNull();
  });

  // The agent just told us where the human is. That is fresher than an answer this browser gave a
  // month ago, so it wins — and is kept, so the next visit opens in the same place.
  it('the named surface beats a stale remembered one, and is remembered in turn', () => {
    localStorage.setItem('mx_surface', 'opencode');
    at('?source=codex');
    expect(screen.getByRole('button', { name: 'Use in Codex CLI' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('mx_surface')).toBe('codex');
  });

  it('falls back to the picker with no source, exactly as it does today', () => {
    at('');
    expect(screen.getByRole('button', { name: /generate a token/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/expires in/i)).toBeInTheDocument();
    // Folded exactly as it is everywhere else it appears, and nothing written to the store.
    expect(screen.getByRole('button', { name: /install for my agent/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: /agent surfaces/i })).toBeNull();
    expect(localStorage.getItem('mx_surface')).toBeNull();
  });

  it('falls back to the picker on a source it does not know', () => {
    at('?source=totally-made-up');
    expect(screen.getByRole('button', { name: /generate a token/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /install for my agent/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/plugin marketplace add/i)).toBeNull();
    expect(localStorage.getItem('mx_surface')).toBeNull();
  });

  it('keeps a remembered surface when no agent named one', () => {
    localStorage.setItem('mx_surface', 'codex');
    at('');
    fireEvent.click(screen.getByRole('button', { name: /install for my agent/i }));
    expect(screen.getByRole('button', { name: 'Use in Codex CLI' })).toHaveAttribute('aria-pressed', 'true');
  });
});
