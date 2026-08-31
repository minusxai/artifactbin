/**
 * The ingest allowance. Importing makes THIS SERVER fetch a URL, so an
 * identity gets a bounded number of ATTEMPTS per hour — attempts, not
 * successes, because the abuse shape is probing and probes fail. Without this
 * the import doors are a port-scanning oracle with a bandwidth bill.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resetWebIngestRateLimit, webIngestRateLimited } from '@/lib/auth';
import { WEB_INGEST_MAX_PER_HOUR } from '@/lib/config';

afterEach(() => resetWebIngestRateLimit());

describe('webIngestRateLimited', () => {
  it('allows exactly the cap, then refuses', () => {
    for (let i = 0; i < WEB_INGEST_MAX_PER_HOUR; i++) {
      expect(webIngestRateLimited('ingest:tok_a'), `attempt ${i + 1}`).toBe(false);
    }
    expect(webIngestRateLimited('ingest:tok_a')).toBe(true);
  });

  it('counts per IDENTITY — one token cannot spend another\'s allowance', () => {
    for (let i = 0; i < WEB_INGEST_MAX_PER_HOUR; i++) webIngestRateLimited('ingest:tok_a');
    expect(webIngestRateLimited('ingest:tok_a')).toBe(true);
    expect(webIngestRateLimited('ingest:tok_b')).toBe(false);
  });

  it('is a rolling window: attempts older than an hour stop counting', () => {
    const t0 = 1_000_000_000_000;
    for (let i = 0; i < WEB_INGEST_MAX_PER_HOUR; i++) webIngestRateLimited('ingest:tok_c', t0);
    expect(webIngestRateLimited('ingest:tok_c', t0)).toBe(true);
    // Still inside the window…
    expect(webIngestRateLimited('ingest:tok_c', t0 + 59 * 60 * 1000)).toBe(true);
    // …and past it, the allowance is whole again.
    expect(webIngestRateLimited('ingest:tok_c', t0 + 61 * 60 * 1000)).toBe(false);
  });

  it('refusing does not spend more allowance — a blocked caller cannot dig deeper', () => {
    const t0 = 2_000_000_000_000;
    for (let i = 0; i < WEB_INGEST_MAX_PER_HOUR; i++) webIngestRateLimited('ingest:tok_d', t0);
    for (let i = 0; i < 50; i++) webIngestRateLimited('ingest:tok_d', t0);
    // One second past the window, the ORIGINAL attempts expire and the caller
    // is whole — proof the refusals were not recorded on top of them.
    expect(webIngestRateLimited('ingest:tok_d', t0 + 60 * 60 * 1000 + 1000)).toBe(false);
  });

  it('resets for tests', () => {
    for (let i = 0; i < WEB_INGEST_MAX_PER_HOUR; i++) webIngestRateLimited('ingest:tok_e');
    expect(webIngestRateLimited('ingest:tok_e')).toBe(true);
    resetWebIngestRateLimit();
    expect(webIngestRateLimited('ingest:tok_e')).toBe(false);
  });
});
