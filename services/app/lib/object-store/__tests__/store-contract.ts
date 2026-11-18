/**
 * The contracts both object-store backends must satisfy identically, run against each by store.test.ts (the local
 * backend) and store-s3.test.ts (a real S3-compatible server). If the two ever diverge, the app behaves differently on
 * a laptop than in production.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectUnavailable, type ObjectStore } from '../index';

/** The contract both backends must satisfy identically. */
export function contractSuite(name: string, make: () => Promise<ObjectStore>) {
  describe(`${name} backend`, () => {
    let store: ObjectStore;
    beforeEach(async () => { store = await make(); });

    it('round-trips bytes', async () => {
      await store.put('dataset/one', 'month,revenue\n2026-01,120');
      expect((await store.get('dataset/one')).toString()).toBe('month,revenue\n2026-01,120');
    });

    it('round-trips BINARY content without corruption', async () => {
      const bytes = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x00]);
      await store.put('blob/bin', bytes);
      expect(Buffer.compare(await store.get('blob/bin'), bytes)).toBe(0);
    });

    it('preserves UTF-8 beyond ASCII', async () => {
      await store.put('dataset/utf', 'naïve,café,日本\n1,2,3');
      expect((await store.get('dataset/utf')).toString()).toBe('naïve,café,日本\n1,2,3');
    });

    it('raises ObjectUnavailable for a missing key — an ERROR, never an empty answer', async () => {
      // The DB is the only index: a key the app asks for is one a row recorded,
      // so "missing" and "denied" are the same failure to a consumer. Which is
      // why no backend needs to tell them apart (no s3:ListBucket, ever).
      await expect(store.get('dataset/nope')).rejects.toBeInstanceOf(ObjectUnavailable);
    });

    it('overwrites an existing key', async () => {
      await store.put('dataset/k', 'first');
      await store.put('dataset/k', 'second');
      expect((await store.get('dataset/k')).toString()).toBe('second');
    });

    it('deletes, and deleting twice is not an error', async () => {
      await store.put('dataset/gone', 'x');
      await store.delete('dataset/gone');
      await expect(store.get('dataset/gone')).rejects.toBeInstanceOf(ObjectUnavailable);
      await expect(store.delete('dataset/gone')).resolves.toBeUndefined();
    });

    it('handles an empty body', async () => {
      await store.put('dataset/empty', '');
      expect((await store.get('dataset/empty')).length).toBe(0);
    });

    it('nests keys with slashes', async () => {
      await store.put('dataset/deep/er/key', 'v');
      expect((await store.get('dataset/deep/er/key')).toString()).toBe('v');
    });
  });
}

/** What `getStream` hands back, read whole. */
const streamed = async (store: ObjectStore, key: string, range?: { start: number; end: number }): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of await store.getStream(key, range)) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
};

export function streamSuite(name: string, make: () => Promise<ObjectStore>) {
  describe(`${name} backend`, () => {
    let store: ObjectStore;
    beforeEach(async () => { store = await make(); });

    it('streams the whole object', async () => {
      await store.put('pdf/whole', Buffer.from('%PDF-1.7 hello'));
      expect((await streamed(store, 'pdf/whole')).toString()).toBe('%PDF-1.7 hello');
    });

    it('streams ONE inclusive byte range — what a PDF viewer seeking asks for', async () => {
      await store.put('pdf/ranged', Buffer.from('0123456789'));
      expect((await streamed(store, 'pdf/ranged', { start: 2, end: 5 })).toString()).toBe('2345');
      expect((await streamed(store, 'pdf/ranged', { start: 9, end: 9 })).toString()).toBe('9');
    });

    it('raises ObjectUnavailable for a missing key, like get — never an empty stream', async () => {
      await expect(store.getStream('pdf/nope')).rejects.toBeInstanceOf(ObjectUnavailable);
    });
  });
}
