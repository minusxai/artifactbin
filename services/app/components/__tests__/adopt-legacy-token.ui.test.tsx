/**
 * The one-time bridge for a browser that still holds a pre-cookie token.
 *
 * Before this branch an anonymous owner's credential lived in
 * `localStorage('mx_token' | 'mx_tokens')` and the app read it in place. After
 * it, authorization is the httpOnly cookie alone — so a RETURNING anonymous
 * owner would be a stranger to their own documents until they re-pasted a
 * token they may not have kept.
 *
 * So on any app page, a leftover value is exchanged for the cookie ONCE and
 * then deleted. It is a bridge, not a store: nothing here ever writes
 * localStorage, and after it runs the browser holds the credential the way
 * everything else expects.
 *
 * (It cannot run on /a/<id> for such an owner — they are served the document
 * itself, which is opaque-origin and has no access to the app's storage. They
 * reach it by opening the app, which is where their documents are listed.)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const refresh = vi.fn();
vi.mock('@/lib/navigation', () => ({ useRouter: () => ({ refresh, push: () => {}, replace: () => {}, back: () => {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

import AdoptLegacyToken from '../AdoptLegacyToken';

let exchanged: string[];
let accept: boolean;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  refresh.mockClear();
  exchanged = [];
  accept = true;
  vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
    if (String(url) === '/api/session/token' && init?.method === 'POST') {
      exchanged.push(JSON.parse(String(init.body)).token);
      return new Response(JSON.stringify(accept ? { ok: true } : { error: 'unauthorized' }), { status: accept ? 200 : 401 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch);
});

afterEach(() => vi.unstubAllGlobals());

describe('AdoptLegacyToken', () => {
  it('exchanges a leftover token and DELETES it — the bridge leaves nothing behind', async () => {
    localStorage.setItem('mx_token', 'mx_legacy');
    render(<AdoptLegacyToken />);
    await waitFor(() => expect(exchanged).toEqual(['mx_legacy']));
    await waitFor(() => {
      expect(localStorage.getItem('mx_token')).toBeNull();
      expect(localStorage.getItem('mx_tokens')).toBeNull();
    });
    expect(refresh).toHaveBeenCalled(); // the page re-renders as an owner
  });

  it('takes the MOST RECENT of the list — the one that authorized writes', async () => {
    localStorage.setItem('mx_tokens', JSON.stringify(['mx_old', 'mx_newest']));
    render(<AdoptLegacyToken />);
    await waitFor(() => expect(exchanged).toEqual(['mx_newest']));
  });

  it('does nothing at all when there is nothing to migrate', async () => {
    render(<AdoptLegacyToken />);
    await new Promise((r) => setTimeout(r, 20));
    expect(exchanged).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores a value that is not a token, rather than posting rubbish', async () => {
    localStorage.setItem('mx_tokens', JSON.stringify(['not-a-token', 42]));
    localStorage.setItem('mx_token', 'also-not');
    render(<AdoptLegacyToken />);
    await new Promise((r) => setTimeout(r, 20));
    expect(exchanged).toEqual([]);
  });

  it('a REFUSED token is cleared too — a revoked one must not be retried forever', async () => {
    accept = false;
    localStorage.setItem('mx_token', 'mx_revoked');
    render(<AdoptLegacyToken />);
    await waitFor(() => expect(exchanged).toEqual(['mx_revoked']));
    await waitFor(() => expect(localStorage.getItem('mx_token')).toBeNull());
    expect(refresh).not.toHaveBeenCalled(); // nothing changed for this browser
  });

  it('runs ONCE per browser session, not on every page it is mounted on', async () => {
    localStorage.setItem('mx_token', 'mx_legacy');
    const first = render(<AdoptLegacyToken />);
    await waitFor(() => expect(exchanged).toEqual(['mx_legacy']));
    first.unmount();
    localStorage.setItem('mx_token', 'mx_legacy'); // as if another tab wrote it back
    render(<AdoptLegacyToken />);
    await new Promise((r) => setTimeout(r, 20));
    expect(exchanged).toEqual(['mx_legacy']); // still just the one
  });
});
