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
  it.each([{}, { 'content-length': '5' }] as Record<string, string>[])('refuses a cloned body before its unread sibling is done (%j)', async headers => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      stream = controller;
      stream.enqueue(new TextEncoder().encode('abcde'));
    } });
    const request = new Request('http://x.test/', { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
    let failure: unknown;
    const outcome = readBody(request.clone(), { limit: 4 }).catch(error => { failure = error; });
    try {
      // The probe has one already-queued chunk and no pending I/O. Let it reach the cap before touching the sibling.
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(failure).toMatchObject({ name: 'BodyTooLargeError', limit: 4 });
      expect(request.bodyUsed).toBe(false);
    } finally {
      stream.close();
      expect(await request.text()).toBe('abcde');
      await outcome;
    }
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
