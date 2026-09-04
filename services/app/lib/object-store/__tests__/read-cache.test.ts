/**
 * ONE CACHE, AT THE LAYER THE BYTES COME FROM.
 *
 * Every key this app reads is IMMUTABLE — content-addressed (`dataset/`,
 * `image/`, `webfont/` are `kind/sha256`) or version-addressed
 * (`exports/<id>/<version>…`). So the store itself is where a read cache
 * belongs: one place, serving datasets, ref images, webfonts and export bytes
 * alike, rather than a separate cache per caller (which is how a dataset-only
 * cache would have grown into four).
 *
 * Why it matters, measured: a document reading three datasets fetched all
 * three from S3 on EVERY render and every `/query` — 3.6s to first byte, and
 * `select 1` through the document's own transport at 4.5s.
 *
 * The bound is BYTES, not entries: these range from a 2 KB webfont to a 27 MB
 * sheet, so counting entries bounds nothing.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cachedReads, resetReadCache } from '../index';

const backing = (bytes: Record<string, Buffer>, calls: string[]) => ({
  backend: 'local' as const,
  async get(key: string) { calls.push(key); const b = bytes[key]; if (!b) throw new Error('missing'); return b; },
  async put() {}, async delete() {},
  // The cache passes a stream read straight through and never records it; this
  // double refuses one so a caller that started streaming here would be loud.
  async getStream(): Promise<never> { throw new Error('the read cache never streams'); },
});

beforeEach(() => { resetReadCache(); });

describe('the store read cache', () => {
  it('asks the backing store once per key', async () => {
    const calls: string[] = [];
    const store = cachedReads(backing({ 'dataset/abc': Buffer.from('[1,2]') }, calls));
    expect((await store.get('dataset/abc')).toString()).toBe('[1,2]');
    expect((await store.get('dataset/abc')).toString()).toBe('[1,2]');
    expect(calls).toEqual(['dataset/abc']);
  });

  it('shares one fetch between concurrent readers of the same document', async () => {
    const calls: string[] = [];
    const store = cachedReads(backing({ 'image/xyz': Buffer.from('png') }, calls));
    await Promise.all([store.get('image/xyz'), store.get('image/xyz'), store.get('image/xyz')]);
    expect(calls).toEqual(['image/xyz']);
  });

  it('never caches a failure — a broken bucket must not become permanent', async () => {
    const calls: string[] = [];
    const bytes: Record<string, Buffer> = {};
    const store = cachedReads(backing(bytes, calls));
    await expect(store.get('dataset/flaky')).rejects.toThrow();
    bytes['dataset/flaky'] = Buffer.from('[]');
    expect((await store.get('dataset/flaky')).toString()).toBe('[]');
    expect(calls).toEqual(['dataset/flaky', 'dataset/flaky']);
  });

  it('forgets a key that is written or deleted, whatever the key names', async () => {
    const calls: string[] = [];
    const bytes = { 'exports/a/1.png': Buffer.from('first') };
    const store = cachedReads(backing(bytes, calls));
    await store.get('exports/a/1.png');
    bytes['exports/a/1.png'] = Buffer.from('second');
    await store.put('exports/a/1.png', 'second');
    expect((await store.get('exports/a/1.png')).toString()).toBe('second');
    await store.delete('exports/a/1.png');
    bytes['exports/a/1.png'] = Buffer.from('third');
    expect((await store.get('exports/a/1.png')).toString()).toBe('third');
  });

  it('is bounded by BYTES — one huge object cannot hold the rest hostage', async () => {
    const calls: string[] = [];
    const big = Buffer.alloc(40 * 1024 * 1024, 1); // over the budget on its own
    const store = cachedReads(backing({ 'dataset/big': big, 'dataset/small': Buffer.from('s') }, calls));
    await store.get('dataset/big');
    await store.get('dataset/small');
    await store.get('dataset/small');
    await store.get('dataset/big');
    // the small one stayed; the huge one was evicted (or never admitted)
    expect(calls.filter((k) => k === 'dataset/small')).toHaveLength(1);
    expect(calls.filter((k) => k === 'dataset/big').length).toBeGreaterThan(1);
  });
});
