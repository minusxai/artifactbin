import {describe, expect, it} from 'vitest';
import {anonymousReader, createRenderCache, NONCE_PLACEHOLDER, renderKey, withFreshNonce, type CachedRender} from '../render-cache';

const body = (n: number): CachedRender => ({status: 200, headers: [], body: new Uint8Array(n)});

describe('render cache', () => {
  it('expires an entry at its lifetime', () => {
    let now = 1000;
    const cache = createRenderCache({maxBytes: 10_000, clock: {now: () => now}});
    cache.set('a', body(10), 30_000);
    now += 29_999;
    expect(cache.get('a')).toBeDefined();
    now += 1;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.bytes).toBe(0);
  });

  it('evicts the least recently used entry when the bytes bound is passed', () => {
    const cache = createRenderCache({maxBytes: 250});
    cache.set('a', body(100), 60_000);
    cache.set('b', body(100), 60_000);
    expect(cache.get('a')).toBeDefined();
    cache.set('c', body(100), 60_000);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
    expect(cache.bytes).toBeLessThanOrEqual(250);
  });

  it('never retains a body larger than the whole bound, and replacing a key frees its old bytes', () => {
    const cache = createRenderCache({maxBytes: 100});
    cache.set('big', body(500), 60_000);
    expect(cache.size).toBe(0);
    cache.set('a', body(50), 60_000);
    cache.set('a', body(20), 60_000);
    expect(cache.size).toBe(1);
    expect(cache.bytes).toBeLessThan(50);
  });

  it('names every fact in its key', () => {
    expect(renderKey({id: 'a', version: 1})).not.toBe(renderKey({id: 'a', version: 2}));
    expect(renderKey({id: 'a', version: 1})).toBe(renderKey({id: 'a', version: 1}));
  });

  it('gives every response its own nonce', () => {
    const template = `<meta content="'nonce-${NONCE_PLACEHOLDER}'"><script nonce="${NONCE_PLACEHOLDER}"></script>`;
    const one = withFreshNonce(template), two = withFreshNonce(template);
    expect(one).not.toContain(NONCE_PLACEHOLDER);
    const nonces = (html: string) => [...html.matchAll(/nonce[-=]"?([0-9a-f]{32})/g)].map(m => m[1]);
    expect(new Set(nonces(one)).size).toBe(1);
    expect(nonces(one)[0]).not.toBe(nonces(two)[0]);
  });

  it('serves only a reader with no account, token or carried grant', () => {
    expect(anonymousReader({userId: null, tokenId: null})).toBe(true);
    expect(anonymousReader({userId: 'usr_1', tokenId: null})).toBe(false);
    expect(anonymousReader({userId: null, tokenId: 'tok'})).toBe(false);
    expect(anonymousReader({userId: null, tokenId: null}, {grants: 1})).toBe(false);
  });
});
