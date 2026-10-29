import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { BodyTooLargeError, collectNodeBody, readBody } from '../body';

/** A streamed body with no content-length, as a chunked upload arrives. */
const streamed = (chunks: string[], headers: Record<string, string> = {}) => new Request('http://x.test/', {
  method: 'POST', headers,
  body: new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk)); c.close(); } }),
  duplex: 'half',
} as RequestInit);

describe('readBody', () => {
  it('accepts a body exactly at the cap and refuses one byte past it', async () => {
    expect(await readBody(streamed(['ab', 'cd']), { limit: 4, as: 'text' })).toBe('abcd');
    await expect(readBody(streamed(['ab', 'cde']), { limit: 4, as: 'text' })).rejects.toBeInstanceOf(BodyTooLargeError);
  });
  it('counts bytes, not characters', async () => {
    expect(await readBody(streamed(['éé']), { limit: 4, as: 'text' })).toBe('éé');
    await expect(readBody(streamed(['ééé']), { limit: 4, as: 'text' })).rejects.toBeInstanceOf(BodyTooLargeError);
  });
  it('refuses on a declared length without reading, and stops a body that lies about it', async () => {
    await expect(readBody(streamed(['a'], { 'content-length': '5000' }), { limit: 10 })).rejects.toBeInstanceOf(BodyTooLargeError);
    await expect(readBody(streamed(['x'.repeat(100)], { 'content-length': '1' }), { limit: 10 })).rejects.toBeInstanceOf(BodyTooLargeError);
  });
  it('an absent body is empty', async () => {
    expect((await readBody(new Request('http://x.test/'), { limit: 1 })).byteLength).toBe(0);
  });
});

describe('collectNodeBody', () => {
  it('returns the bytes within the cap and null past it', async () => {
    expect((await collectNodeBody(Readable.from([Buffer.from('ab'), Buffer.from('cd')]), 4))?.toString()).toBe('abcd');
    expect(await collectNodeBody(Readable.from([Buffer.from('ab'), Buffer.from('cde')]), 4)).toBeNull();
  });
});
