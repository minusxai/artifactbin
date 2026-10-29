/** The document fetch quota: anonymous readers are bucketed by client IP, and the in-memory buckets are bounded. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { documentFetchRateLimited, documentFetchReader, resetAllowances, setDocumentFetchCapForTests, webIngestBucketCount } from '@/lib/allowances';

const via = (xff?: string) => new Request('http://x.test/a/doc/fetch', { headers: xff ? { 'x-forwarded-for': xff } : {} });
const guest = { userId: null, tokenId: null };

beforeEach(() => { resetAllowances(); setDocumentFetchCapForTests(2); });
afterEach(() => { resetAllowances(); setDocumentFetchCapForTests(null); });

describe('documentFetchReader', () => {
  it('names the account or token when there is one, else the proxy-observed client IP', () => {
    expect(documentFetchReader({ userId: 'u1', tokenId: 't1' }, via('9.9.9.9'))).toBe('u1');
    expect(documentFetchReader({ userId: null, tokenId: 't1' }, via('9.9.9.9'))).toBe('t1');
    expect(documentFetchReader(guest, via('spoofed, 203.0.113.7'))).toBe('guest:203.0.113.7');
    expect(documentFetchReader(guest, via('203.0.113.8'))).toBe('guest:203.0.113.8');
    expect(documentFetchReader(guest, via())).toBe('guest');
  });
});

describe('documentFetchRateLimited', () => {
  it('one IP exhausting its allowance leaves another IP untouched', () => {
    const a = documentFetchReader(guest, via('203.0.113.7')), b = documentFetchReader(guest, via('203.0.113.8'));
    expect([1, 2, 3].map(() => documentFetchRateLimited('doc', a))).toEqual([false, false, true]);
    expect(documentFetchRateLimited('doc', b)).toBe(false);
    expect(documentFetchRateLimited('other-doc', a)).toBe(false);
  });
  it('allowance returns after the hour, and expired buckets are swept rather than kept forever', () => {
    const t0 = 1_000_000;  // far from the wall clock: the sweep clock is reset with the buckets
    for (let i = 0; i < 100; i++) documentFetchRateLimited('doc', `guest:10.0.0.${i}`, t0);
    expect(webIngestBucketCount()).toBe(100);
    const later = t0 + 61 * 60 * 1000;
    expect(documentFetchRateLimited('doc', 'guest:10.0.0.0', later)).toBe(false);
    expect(webIngestBucketCount()).toBe(1);
  });
});
