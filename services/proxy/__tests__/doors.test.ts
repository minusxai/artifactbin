/**
 * THE DOORS — one generic limiter, every door the same four knobs. The engine
 * lives in @artifactbin/utils and the vocabulary in @artifactbin/contracts;
 * this is the proxy's suite over them (moved from the old doors.test.ts; the
 * postgres backend's halves died with the backend — memory is the only
 * backend now). doorsEnv's environment-dependent default moved here from
 * assemble.test.ts with the assembly it replaced.
 *
 * MAX and WINDOW say how much; KEY says who; BURST says how much MORE a caller
 * who proved a credential gets — on the SAME bucket. That last clause is the
 * mint-ceiling lesson: a separate holder bucket is the old hole with an extra
 * step, because the stranger mints that bought the credential would not count
 * against what the token then spends.
 */
import { describe, expect, it } from 'vitest';
import { DOORS, type DoorName } from '@artifactbin/contracts';
import { createLimiter, doorConfig, doorsEnv, memoryBackend } from '@artifactbin/utils';

const IP = '203.0.113.42';
const at = (s: number) => 1_700_000_000_000 + s * 1000;

describe('door configuration', () => {
  it('every door has the same four knobs, read from RATE_LIMITER__<DOOR>_<KNOB>', () => {
    const c = doorConfig('ANON_MINT', { RATE_LIMITER__ANON_MINT_MAX: '7', RATE_LIMITER__ANON_MINT_WINDOW: '120', RATE_LIMITER__ANON_MINT_BURST: '3', RATE_LIMITER__ANON_MINT_KEY: 'ip+actor' });
    expect(c).toEqual({ max: 7, windowSeconds: 120, burst: 3, key: 'ip+actor' });
  });
  it('unset knobs fall back to the door\'s defaults; anonymous minting is CLOSED by default', () => {
    expect(doorConfig('ANON_MINT', {}).max).toBe(0);
    expect(doorConfig('MUTATE', {}).max).toBe(60);
    expect(doorConfig('GLOBAL', {}).key).toBe('ip');
    expect(doorConfig('EXPORT', {}).key).toBe('actor');
  });
  it('an unknown door is a programming error, not a silent pass', () => {
    expect(() => doorConfig('NOPE' as DoorName, {})).toThrow(/unknown door/i);
  });
});

describe('the limiter over the memory backend', () => {
  it('allows MAX hits inside WINDOW, then denies with a retryAfter that lands after the oldest hit expires', async () => {
    const limiter = createLimiter({ backend: memoryBackend(), env: { RATE_LIMITER__MUTATE_MAX: '3', RATE_LIMITER__MUTATE_WINDOW: '60' } });
    for (let i = 0; i < 3; i++) expect((await limiter.limit('MUTATE', { ip: IP }, { now: at(i) })).allowed).toBe(true);
    const d = await limiter.limit('MUTATE', { ip: IP }, { now: at(10) });
    expect(d.allowed).toBe(false);
    expect(d.retryAfter).toBe(50); // the first hit (t=0) leaves the window at t=60
    expect((await limiter.limit('MUTATE', { ip: IP }, { now: at(61) })).allowed).toBe(true);
  });

  it('keys on ip, actor, or both — a different key is a different bucket', async () => {
    const limiter = createLimiter({ backend: memoryBackend(), env: { RATE_LIMITER__PUBLISH_MAX: '1', RATE_LIMITER__PUBLISH_KEY: 'actor', RATE_LIMITER__QUERY_MAX: '1', RATE_LIMITER__QUERY_KEY: 'ip+actor' } });
    expect((await limiter.limit('PUBLISH', { ip: IP, actorId: 'usr_a' })).allowed).toBe(true);
    expect((await limiter.limit('PUBLISH', { ip: '198.51.100.1', actorId: 'usr_a' })).allowed, 'same actor from another ip shares the bucket').toBe(false);
    expect((await limiter.limit('PUBLISH', { ip: IP, actorId: 'usr_b' })).allowed).toBe(true);
    expect((await limiter.limit('QUERY', { ip: IP, actorId: 'usr_a' })).allowed).toBe(true);
    expect((await limiter.limit('QUERY', { ip: IP, actorId: 'usr_b' })).allowed, 'ip+actor: a different actor on the same ip is its own bucket').toBe(true);
    expect((await limiter.limit('QUERY', { ip: IP, actorId: 'usr_a' })).allowed).toBe(false);
  });

  it('an actor-keyed door with no actor falls back to the ip, never to a shared bucket', async () => {
    const limiter = createLimiter({ backend: memoryBackend(), env: { RATE_LIMITER__EXPORT_MAX: '1' } });
    expect((await limiter.limit('EXPORT', { ip: IP })).allowed).toBe(true);
    expect((await limiter.limit('EXPORT', { ip: '198.51.100.1' })).allowed).toBe(true);
    expect((await limiter.limit('EXPORT', { ip: IP })).allowed).toBe(false);
  });

  it('BURST raises the ceiling for a holder on the SAME bucket — the mint-ceiling rule', async () => {
    const limiter = createLimiter({ backend: memoryBackend(), env: { RATE_LIMITER__ANON_MINT_MAX: '2', RATE_LIMITER__ANON_MINT_BURST: '3' } });
    expect((await limiter.limit('ANON_MINT', { ip: IP })).allowed).toBe(true);
    expect((await limiter.limit('ANON_MINT', { ip: IP })).allowed).toBe(true);
    expect((await limiter.limit('ANON_MINT', { ip: IP })).allowed, 'the stranger is done').toBe(false);
    // the holder continues — but the stranger's two mints already came out of the shared six
    for (let i = 0; i < 4; i++) expect((await limiter.limit('ANON_MINT', { ip: IP, holder: true })).allowed, `holder ${i + 1} of 4`).toBe(true);
    expect((await limiter.limit('ANON_MINT', { ip: IP, holder: true })).allowed).toBe(false);
    // and a denied attempt is not counted, so the holder's ceiling is not eroded by the stranger's refusals
    expect((await limiter.limit('ANON_MINT', { ip: IP })).allowed).toBe(false);
    expect((await limiter.limit('ANON_MINT', { ip: IP, holder: true })).allowed).toBe(false);
  });

  it('MAX=0 closes the door for everyone, holder included', async () => {
    const limiter = createLimiter({ backend: memoryBackend(), env: {} });
    expect((await limiter.limit('ANON_MINT', { ip: IP })).allowed).toBe(false);
    expect((await limiter.limit('ANON_MINT', { ip: IP, holder: true })).allowed).toBe(false);
  });

  it('concurrency doors count OPEN streams, released explicitly', async () => {
    const limiter = createLimiter({ backend: memoryBackend(), env: { RATE_LIMITER__EVENTS_STREAMS_MAX: '2' } });
    const a = await limiter.acquire('EVENTS_STREAMS', { ip: IP });
    const b = await limiter.acquire('EVENTS_STREAMS', { ip: IP });
    expect(a.allowed && b.allowed).toBe(true);
    expect((await limiter.acquire('EVENTS_STREAMS', { ip: IP })).allowed).toBe(false);
    await a.release();
    expect((await limiter.acquire('EVENTS_STREAMS', { ip: IP })).allowed).toBe(true);
  });
});

describe('doorsEnv (the environment-dependent default)', () => {
  it('closes anonymous minting in production, relaxes it in development, and honours an explicit value', () => {
    expect(doorsEnv({ NODE_ENV: 'production' }).RATE_LIMITER__ANON_MINT_MAX).toBe('0');
    expect(doorsEnv({ NODE_ENV: 'development' }).RATE_LIMITER__ANON_MINT_MAX).toBe('1000');
    expect(doorsEnv({ NODE_ENV: 'development', RATE_LIMITER__ANON_MINT_MAX: '3' }).RATE_LIMITER__ANON_MINT_MAX).toBe('3');
    expect(doorsEnv({ NODE_ENV: 'production', RATE_LIMITER__ANON_MINT_MAX: '7' }).RATE_LIMITER__ANON_MINT_MAX).toBe('7');
    expect(doorsEnv({ RATE_LIMITER__MUTATE_MAX: '9' }).RATE_LIMITER__MUTATE_MAX).toBe('9');
  });
  it('names every door the contracts do — the vocabulary is shared, not copied', () => {
    expect(Object.keys(DOORS).sort()).toEqual(['ANON_MINT', 'EDIT', 'EVENTS_STREAMS', 'EXPORT', 'GLOBAL', 'LOGIN_SEND', 'LOGIN_VERIFY', 'MUTATE', 'OAUTH_REGISTER', 'OAUTH_TOKEN', 'PUBLISH', 'QUERY', 'START_LINK']);
  });
});
