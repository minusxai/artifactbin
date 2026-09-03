/**
 * M4 — /tokens/new?source=<surface>.
 *
 * The human landed here because their agent had no token and sent them. That is the one moment they
 * will ever be receptive to "install the plugin and never do this again", and the page currently says
 * nothing. The token stays exactly as available as it was; the recommendation sits above it.
 *
 * Seeded RED by the orchestrator; make it green without changing an expectation.
 */
import { cleanup, render, screen } from '@testing-library/react';
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

  it('falls back to the picker with no source, exactly as it does today', () => {
    at('');
    expect(screen.getByRole('button', { name: /generate a token/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/expires in/i)).toBeInTheDocument();
  });

  it('falls back to the picker on a source it does not know', () => {
    at('?source=totally-made-up');
    expect(screen.getByRole('button', { name: /generate a token/i })).toBeInTheDocument();
  });
});
