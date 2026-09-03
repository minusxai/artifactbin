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
import GetStarted, { sourceSurface } from '@/components/GetStarted';

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

/** Reading order, asked of the DOM rather than of a string index. */
const precedes = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

const httpOption = () => screen.getByText(/no installation/i);
const installDoor = () => screen.getByRole('button', { name: /install for my agent/i });

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

  // An AGENT writes this string, not a human — and a wrong case does not produce a wrong card, it
  // produces NO card, which is the worse outcome by far. So the case is folded before the key is
  // matched. Everything that is still not a surface after folding is null, exactly as before.
  it('folds the case — an agent writing Claude-Code still gets the Claude Code card', () => {
    expect(sourceSurface('?source=Claude-Code')).toBe('claude-code');
    expect(sourceSurface('?source=CLAUDE-CODE')).toBe('claude-code');
    expect(sourceSurface('?source=CODEX')).toBe('codex');
    expect(sourceSurface('?source=Codex')).toBe('codex');
    expect(sourceSurface('?source=cLaUdE-CoDe-ApP')).toBe('claude-code-app');
  });

  it('is still null for what folding does not rescue, and never throws on a query at all', () => {
    for (const q of ['?source=Claude Code', '?source= claude-code', '?source=Nonsense', '?source=claude_code']) {
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

/**
 * WHICH PATH LEADS. A visitor to /tokens/new is standing here BECAUSE the no-installation path just
 * cost them a round trip — leading with it again is the panel answering a question they have already
 * had answered the hard way. So when an agent named a surface, install leads; everywhere else the
 * component is byte-identical to what the landing page and /docs-human already render.
 */
describe('lead — which of the two paths comes first', () => {
  it('leads with the HTTP path by default, as the landing page has always shown it', () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>);
    expect(precedes(httpOption(), installDoor())).toBe(true);
  });

  it('leads with install when asked, without restyling either path', () => {
    render(<MemoryRouter><GetStarted lead="install" /></MemoryRouter>);
    expect(precedes(installDoor(), httpOption())).toBe(true);
    // Both paths are still on offer, and still exactly two.
    expect(screen.getByText(/no installation/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^option [12]$/)).toHaveLength(2);
  });

  it('numbers the options by where they actually sit', () => {
    const { unmount } = render(<MemoryRouter><GetStarted lead="install" /></MemoryRouter>);
    expect(installDoor().textContent).toContain('option 1');
    expect(httpOption().closest('div')?.textContent).toContain('option 2');
    unmount();
    render(<MemoryRouter><GetStarted /></MemoryRouter>);
    expect(httpOption().closest('div')?.textContent).toContain('option 1');
    expect(installDoor().textContent).toContain('option 2');
  });
});

describe('the page leads with install exactly when an agent named a surface', () => {
  it('a named surface puts the install path first', () => {
    at('?source=claude-code');
    expect(precedes(installDoor(), httpOption())).toBe(true);
    expect(installDoor().textContent).toContain('option 1');
  });

  it('a folded-case surface leads with install too — the fold reaches the whole page', () => {
    at('?source=CODEX');
    expect(precedes(installDoor(), httpOption())).toBe(true);
    expect(screen.getByRole('button', { name: 'Use in Codex CLI' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/interactive installer/i)).toBeInTheDocument();
  });

  it('no source, no reordering — the panel reads exactly as it does everywhere else', () => {
    at('');
    expect(precedes(httpOption(), installDoor())).toBe(true);
    expect(installDoor().textContent).toContain('option 2');
  });

  it('an unknown source, no reordering', () => {
    at('?source=totally-made-up');
    expect(precedes(httpOption(), installDoor())).toBe(true);
  });

  it('the mint is still last and still mints whichever path leads', async () => {
    const secret = `mx_${'b'.repeat(43)}`;
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? 'null')) });
      if (String(url).endsWith('/api/tokens/anonymous')) {
        return new Response(JSON.stringify({ token: secret, expiresAt: '2026-09-01T00:00:00.000Z' }), { status: 201 });
      }
      return new Response(null, { status: 204 });
    }));
    at('?source=Claude-Code');
    const mint = screen.getByRole('button', { name: /generate a token/i });
    // A folded-case source leads with install, and BOTH paths still sit above the mint.
    expect(installDoor().textContent).toContain('option 1');
    expect(precedes(installDoor(), mint)).toBe(true);
    expect(precedes(httpOption(), mint)).toBe(true);
    fireEvent.click(mint);
    expect(await screen.findByText(secret)).toBeInTheDocument();
    expect(calls[0]).toEqual({ url: '/api/tokens/anonymous', body: { expiresInHours: 6 } });
  });
});
