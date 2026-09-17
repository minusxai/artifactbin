/**
 * `isCrossSiteRequest` / `parseCookie` — the two request-reading primitives the
 * cookie-auth surfaces stand on (lib/http).
 *
 * They were only ever exercised THROUGH routes, which hides their edges. Both
 * edges matter:
 *
 *  - a MISSING Origin must not read as cross-site. An agent curling the API
 *    with a bearer token sends none, and treating absence as hostile would
 *    break the whole protocol — the check exists for browsers, which always
 *    send it.
 *  - `Sec-Fetch-Site` is the browser's own verdict and wins when present; only
 *    `cross-site` is refused, because `same-origin` and `same-site` are ours
 *    and `none` is a user-typed address or a bookmark.
 *  - a cookie value is read WHOLE and undecoded: a JWE is URL-safe already,
 *    and a name must never match a prefix of another name.
 */
import { describe, expect, it } from 'vitest';
import { isCrossSiteRequest, parseCookie } from '@/lib/http';

// harness-exempt: request constructs arbitrary absolute origins because request classification is the subject under test

const req = (headers: Record<string, string>, url = 'https://app.test/api/x') =>
  new Request(url, { headers });

describe('isCrossSiteRequest', () => {
  it('is false when nothing says otherwise — an agent sends no Origin', () => {
    expect(isCrossSiteRequest(req({}))).toBe(false);
  });

  it('trusts Sec-Fetch-Site when the browser sent it', () => {
    expect(isCrossSiteRequest(req({ 'sec-fetch-site': 'cross-site' }))).toBe(true);
    for (const site of ['same-origin', 'same-site', 'none']) {
      expect(isCrossSiteRequest(req({ 'sec-fetch-site': site })), site).toBe(false);
    }
  });

  it('prefers Sec-Fetch-Site over Origin, since the browser computed it', () => {
    // A same-origin fetch whose Origin header is absent/odd is still same-origin.
    expect(isCrossSiteRequest(req({ 'sec-fetch-site': 'same-origin', origin: 'https://evil.test' }))).toBe(false);
    expect(isCrossSiteRequest(req({ 'sec-fetch-site': 'cross-site', origin: 'https://app.test' }))).toBe(true);
  });

  it('falls back to comparing Origin HOST when Sec-Fetch-Site is absent', () => {
    expect(isCrossSiteRequest(req({ origin: 'https://app.test' }))).toBe(false);
    expect(isCrossSiteRequest(req({ origin: 'https://evil.test' }))).toBe(true);
    // A different PORT is a different origin — and the host comparison sees it.
    expect(isCrossSiteRequest(req({ origin: 'https://app.test:8443' }))).toBe(true);
  });

  it('compares against the HOST THE CLIENT ADDRESSED, not the server\'s own url', () => {
    // Behind a reverse proxy the app is reached at the public name while
    // `request.url` is the container's internal address, so comparing against
    // that made every Origin look foreign: production answered 403 to any
    // cookie-authenticated mutation from a browser that sends no
    // Sec-Fetch-Site (older Safari). The Host header is what the client asked
    // for, and is what nginx forwards.
    const proxied = (headers: Record<string, string>) =>
      new Request('http://localhost:3000/api/x', { headers });
    expect(isCrossSiteRequest(proxied({ host: 'app.test', origin: 'https://app.test' }))).toBe(false);
    expect(isCrossSiteRequest(proxied({ host: 'app.test', origin: 'https://evil.test' }))).toBe(true);
    // X-Forwarded-Host wins where the proxy rewrites Host as well.
    expect(isCrossSiteRequest(proxied({ host: 'internal:3000', 'x-forwarded-host': 'app.test', origin: 'https://app.test' }))).toBe(false);
  });

  it('treats an unparseable Origin as not ours', () => {
    for (const origin of ['null', 'not a url', '://', 'javascript:alert(1)']) {
      expect(isCrossSiteRequest(req({ origin })), origin).toBe(true);
    }
  });
});

describe('parseCookie', () => {
  it('reads one cookie out of a header, whitespace and all', () => {
    expect(parseCookie('a=1; b=2', 'b')).toBe('2');
    expect(parseCookie('  a=1 ;  b=2  ', 'b')).toBe('2');
  });

  it('matches the WHOLE name — never a prefix or suffix of another', () => {
    const header = 'mx-agent-session=REAL; not-mx-agent-session=DECOY; mx-agent-session-x=DECOY2';
    expect(parseCookie(header, 'mx-agent-session')).toBe('REAL');
    // …and reading a name that is only a prefix of a present one finds nothing.
    expect(parseCookie('mx-agent-session-x=DECOY2', 'mx-agent-session')).toBeUndefined();
  });

  it('returns the value UNDECODED — a JWE is already URL-safe, decoding invents failure modes', () => {
    expect(parseCookie('t=a.b%2Dc_d', 't')).toBe('a.b%2Dc_d');
  });

  it('is undefined for an absent name, an empty header, or none at all', () => {
    expect(parseCookie('a=1', 'b')).toBeUndefined();
    expect(parseCookie('', 'a')).toBeUndefined();
    expect(parseCookie(null, 'a')).toBeUndefined();
  });

  it('tolerates a malformed pair rather than throwing', () => {
    expect(parseCookie('novalue; a=1', 'a')).toBe('1');
  });
});
