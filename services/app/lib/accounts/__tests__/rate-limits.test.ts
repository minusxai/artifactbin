/** The in-memory hourly attempt buckets: per-document import ceilings, and the sweep that keeps the map bounded. */
import { afterEach, describe, expect, it } from 'vitest';
import { docAssetImportRateLimited, resetRateLimit, setDocAssetImportCapForTests, webIngestBucketCount, webIngestRateLimited } from '@/lib/accounts';

afterEach(() => { resetRateLimit(); setDocAssetImportCapForTests(null); });

const MINUTE = 60 * 1000, HOUR = 60 * MINUTE;

describe('expiry and sweep', () => {
  it('a bucket whose last attempt is an hour old is swept on the first call a minute after the previous sweep', () => {
    const t0 = 1_000_000_000_000;
    webIngestRateLimited('a', t0);
    webIngestRateLimited('b', t0 + 30_000);
    expect(webIngestBucketCount()).toBe(2);
    // Past the sweep interval: 'a' (an hour old) goes, 'b' (not quite) stays.
    webIngestRateLimited('c', t0 + HOUR + 10_000);
    expect(webIngestBucketCount()).toBe(2);
    // 'b' is an hour old now, but the next sweep is not due for another 30 s.
    webIngestRateLimited('d', t0 + HOUR + 40_000);
    expect(webIngestBucketCount()).toBe(3);
    webIngestRateLimited('e', t0 + HOUR + 71_000);
    expect(webIngestBucketCount()).toBe(3);
    // A swept key starts over with a whole allowance.
    expect(webIngestRateLimited('a', t0 + HOUR + 72_000)).toBe(false);
  });

  it('resetRateLimit empties every bucket', () => {
    webIngestRateLimited('a');
    docAssetImportRateLimited('art_1');
    expect(webIngestBucketCount()).toBe(2);
    resetRateLimit();
    expect(webIngestBucketCount()).toBe(0);
  });
});

describe('document asset imports', () => {
  it('each document has its own hourly ceiling, separate from identities, and a refusal spends nothing', () => {
    setDocAssetImportCapForTests(2);
    const t0 = 2_000_000_000_000;
    expect(docAssetImportRateLimited('art_1', t0)).toBe(false);
    expect(docAssetImportRateLimited('art_1', t0 + MINUTE)).toBe(false);
    expect(docAssetImportRateLimited('art_1', t0 + 2 * MINUTE)).toBe(true);
    expect(docAssetImportRateLimited('art_2', t0 + 2 * MINUTE)).toBe(false);
    expect(webIngestRateLimited('art_1', t0 + 2 * MINUTE)).toBe(false);
    // The first attempt ages out; the refused one never counted.
    expect(docAssetImportRateLimited('art_1', t0 + HOUR)).toBe(false);
    expect(docAssetImportRateLimited('art_1', t0 + HOUR + 1)).toBe(true);
  });

  it('defaults to thirty an hour once the test cap is cleared', () => {
    setDocAssetImportCapForTests(null);
    const t0 = 3_000_000_000_000;
    for (let i = 0; i < 30; i++) expect(docAssetImportRateLimited('art_1', t0), `attempt ${i + 1}`).toBe(false);
    expect(docAssetImportRateLimited('art_1', t0)).toBe(true);
  });
});
