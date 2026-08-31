/**
 * THE JSON TRANSPORT every service contract rides on: a POST per method, a
 * body cap, a deadline on the client — a hung service is a failure the caller
 * sees, never a render that waits forever.
 */
import http from 'node:http';
import { format } from 'node:util';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { httpClient, jsonServer } from '@artifactbin/utils';

/** POST with the request target EXACTLY as written — `fetch` may normalise a path, and what the server sees in `req.url` is the whole point below. */
function rawPost(base: string, path: string, body: string): Promise<number> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, method: 'POST', path }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('jsonServer + httpClient', () => {
  const server = jsonServer({
    '/echo': async (body) => ({ got: body }),
    '/slow': () => new Promise((r) => setTimeout(() => r({ late: true }), 500)),
    '/boom%s%d': async () => { throw new Error('kaput'); },
  }, { maxBody: 64 });
  const listening = server.listen(0);
  afterAll(() => server.close());

  it('round-trips JSON and turns a Set into an array on the wire', async () => {
    const client = httpClient(listening.url, { deadlineMs: 1000 });
    expect(await client.post('/echo', { names: new Set(['a', 'b']) })).toEqual({ got: { names: ['a', 'b'] } });
  });
  it('is POST-only, 404 for an unknown route, 413 over the body cap', async () => {
    expect((await fetch(`${listening.url}/echo`)).status).toBe(405);
    expect((await fetch(`${listening.url}/nope`, { method: 'POST', body: '{}' })).status).toBe(404);
    expect((await fetch(`${listening.url}/echo`, { method: 'POST', body: JSON.stringify({ x: 'y'.repeat(100) }) })).status).toBe(413);
  });
  it('fails a call at the deadline instead of hanging', async () => {
    const client = httpClient(listening.url, { deadlineMs: 100 });
    await expect(client.post('/slow', {})).rejects.toThrow(/deadline|abort|timeout/i);
  });

  /**
   * THE URL IS DATA, NEVER THE FORMAT STRING. A request target is caller input;
   * baked into `console.error`'s first argument it becomes a format string, and
   * its own `%s`/`%d` then eat the arguments that follow — the error object
   * disappears into a `%s` and the operator reads a line that never happened
   * (CodeQL js/tainted-format-string). The url travels as an ARGUMENT, so it is
   * logged exactly as it arrived.
   */
  it('logs a failing url verbatim — caller input is an argument, not the format string', async () => {
    const calls: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { calls.push(args); });
    try {
      expect(await rawPost(listening.url, '/boom%s%d', '{}')).toBe(400);
    } finally {
      spy.mockRestore();
    }
    expect(calls).toHaveLength(1);
    const [first, ...rest] = calls[0];
    expect(String(first)).not.toContain('/boom');
    expect(format(first, ...rest)).toContain('/boom%s%d');
  });
});
