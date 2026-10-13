/**
 * An S3 that accepts a connection and never answers must fail the read, not hang it: the read cache shares
 * one pending promise per key, so a read that never settles stalls every later reader of that object until
 * the process restarts (seen on a host whose containers briefly had no route to S3).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { cachedReads, createS3Store, resetReadCache } from '../index';

const sockets = new Set<Socket>();
const silent = createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
const listening = new Promise<number>((resolve) => silent.listen(0, '127.0.0.1', () => resolve((silent.address() as { port: number }).port)));
afterAll(() => { for (const socket of sockets) socket.destroy(); silent.close(); });

describe('S3 store against an endpoint that never answers', () => {
  it('rejects the read within its bounds, and the cache asks again afterwards', async () => {
    resetReadCache();
    const endpoint = `http://127.0.0.1:${await listening}`;
    const store = cachedReads(createS3Store(
      { bucket: 'fixture', region: 'us-west-1', accessKeyId: 'test-key', secretAccessKey: 'test-secret', endpoint, forcePathStyle: true, prefix: 'artifacts' },
      { connectionTimeout: 200, requestTimeout: 300 },
    ));
    const started = Date.now();
    await expect(store.get('documents/never-answered')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
    await expect(store.get('documents/never-answered')).rejects.toThrow();
  }, 15_000);
});
