/** The in-memory limiter, moved: same knobs, same rule — a credential raises the ceiling on the SAME bucket, never removes it. */
import { describe, expect, it } from 'vitest';
import { createLimiter, doorConfig, memoryBackend } from '@artifactbin/utils';

const env = { RATE_LIMITER__ANON_MINT_MAX: '2', RATE_LIMITER__ANON_MINT_WINDOW: '60', RATE_LIMITER__ANON_MINT_BURST: '3' };
describe('doors in utils', () => {
  it('reads a door\'s four knobs from RATE_LIMITER__<DOOR>_*', () => {
    expect(doorConfig('ANON_MINT', env)).toMatchObject({ max: 2, windowSeconds: 60, burst: 3 });
  });
  it('allows up to max in the window, then denies with a retryAfter; a holder gets max×burst on the same bucket', async () => {
    const l = createLimiter({ backend: memoryBackend(), env });
    const ip = { ip: '10.0.0.1' };
    expect((await l.limit('ANON_MINT', ip)).allowed).toBe(true);
    expect((await l.limit('ANON_MINT', ip)).allowed).toBe(true);
    const third = await l.limit('ANON_MINT', ip);
    expect(third.allowed).toBe(false); expect(third.retryAfter).toBeGreaterThan(0);
    const holder = { ip: '10.0.0.1', actorId: 'tok_1', holder: true };
    expect((await l.limit('ANON_MINT', holder)).allowed).toBe(true);   // 3rd hit on the same bucket, ceiling now 6
  });
  it('bounds attacker-controlled bucket cardinality and evicts the oldest bucket', async () => {
    const backend = memoryBackend({ maxBuckets: 2 });
    const l = createLimiter({ backend, env: { RATE_LIMITER__ANON_MINT_MAX: '1', RATE_LIMITER__ANON_MINT_WINDOW: '60' } });
    expect((await l.limit('ANON_MINT', { ip: '10.0.0.1' })).allowed).toBe(true);
    expect((await l.limit('ANON_MINT', { ip: '10.0.0.2' })).allowed).toBe(true);
    expect((await l.limit('ANON_MINT', { ip: '10.0.0.3' })).allowed).toBe(true);
    expect((await l.limit('ANON_MINT', { ip: '10.0.0.1' })).allowed, 'the oldest bucket was evicted').toBe(true);
    expect(backend.size()).toBeLessThanOrEqual(2);
  });
});
