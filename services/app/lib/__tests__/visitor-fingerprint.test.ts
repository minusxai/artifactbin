/**
 * The visitor fingerprint reads the same forwarded hop the rate limiter does.
 *
 * `visitor` is what makes every "views" number mean UNIQUE PEOPLE PER DAY
 * rather than requests — `COUNT(DISTINCT visitor)`. It is a salted hash of the
 * day, the IP, the UA and the user id, so it is only as stable as the IP going
 * into it: reading the caller-supplied head of `X-Forwarded-For` lets one
 * visitor present as unlimited distinct ones just by varying a header, which
 * inflates every view count on the platform.
 *
 * Nothing GATES on analytics (see the root CLAUDE.md), so this is not a
 * security boundary — it is a correctness one, and it is the reason the hop
 * selection lives in one shared place (`lib/client-identity` forwardedFor)
 * rather than being spelled out twice.
 */
import { describe, expect, it } from 'vitest';
import { forwardedFor } from '@/lib/client-identity';
import { TRUSTED_PROXY_HOPS } from '@/lib/config';

const h = (headers: Record<string, string>) => new Headers(headers);

describe('forwardedFor — the shared hop selection', () => {
  it('is stable for one visitor however they vary the head they send', () => {
    const a = forwardedFor(h({ 'x-forwarded-for': 'alpha, 203.0.113.7' }), TRUSTED_PROXY_HOPS);
    const b = forwardedFor(h({ 'x-forwarded-for': 'beta, 203.0.113.7' }), TRUSTED_PROXY_HOPS);
    const c = forwardedFor(h({ 'x-forwarded-for': '203.0.113.7' }), TRUSTED_PROXY_HOPS);
    expect(a).toBe('203.0.113.7');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('still distinguishes two real visitors behind one proxy', () => {
    const a = forwardedFor(h({ 'x-forwarded-for': 'same, 203.0.113.7' }), TRUSTED_PROXY_HOPS);
    const b = forwardedFor(h({ 'x-forwarded-for': 'same, 198.51.100.4' }), TRUSTED_PROXY_HOPS);
    expect(a).not.toBe(b);
  });

  it('falls back to x-real-ip, the single-value spelling', () => {
    expect(forwardedFor(h({ 'x-real-ip': '203.0.113.9' }), 1)).toBe('203.0.113.9');
  });

  it('answers empty — not a forged value — when the caller is unidentifiable', () => {
    // analytics treats '' as "no IP signal" and falls back to the UA alone;
    // lib/auth turns it into the shared 'unknown' bucket. Both need the empty
    // answer to be distinguishable from a real address.
    expect(forwardedFor(h({}), 1)).toBe('');
  });

  it('prefers the forwarded chain over x-real-ip when both are present', () => {
    const ip = forwardedFor(h({ 'x-forwarded-for': 'spoof, 203.0.113.7', 'x-real-ip': '10.0.0.9' }), 1);
    expect(ip).toBe('203.0.113.7');
  });
});
