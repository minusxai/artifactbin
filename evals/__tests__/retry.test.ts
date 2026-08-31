/**
 * Retrying the DRIVER's own setup, so a blip does not cost a paid agent run.
 */
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { isTransientStatus, mintStartDocument, withRetry } from '../lib/retry';

const noSleep = { sleep: async () => {} };

describe('isTransientStatus', () => {
  it('covers a gateway with nothing behind it yet, and not an answer', () => {
    for (const s of [502, 503, 504, 429]) expect(isTransientStatus(s)).toBe(true);
    // A 4xx is an ANSWER. Retrying one just asks the same question again.
    for (const s of [200, 400, 401, 404, 409]) expect(isTransientStatus(s)).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns the first success without sleeping', async () => {
    let calls = 0;
    expect(await withRetry('x', async () => { calls++; return 'ok'; }, noSleep)).toBe('ok');
    expect(calls).toBe(1);
  });

  it('rides out a transient run of failures — the case that cost three tasks', async () => {
    let calls = 0;
    const got = await withRetry('POST /api/start', async () => { calls++; return calls < 3 ? null : 'doc'; }, noSleep);
    expect(got).toBe('doc');
    expect(calls).toBe(3);
  });

  it('retries a throw too: a socket that never connected raises rather than answering', async () => {
    let calls = 0;
    const got = await withRetry('x', async () => { calls++; if (calls < 2) throw new Error('ECONNREFUSED'); return 'ok'; }, noSleep);
    expect(got).toBe('ok');
  });

  it('gives up with the LAST failure, so the log says what actually went wrong', async () => {
    await expect(withRetry('x', async () => { throw new Error('ECONNRESET'); }, { ...noSleep, attempts: 2 }))
      .rejects.toThrow(/ECONNRESET/);
  });

  it('backs off further each time — a deployment mid-roll needs seconds', async () => {
    const slept: number[] = [];
    await withRetry('x', async () => null, { attempts: 3, delayMs: 100, sleep: async (ms) => { slept.push(ms); } })
      .catch(() => {});
    expect(slept).toEqual([100, 200]);
  });
});

/**
 * The unit tests above prove the LOOP. This proves the THING: a real HTTP
 * server that answers 502 the way production did — twice, immediately — and
 * then works. Without it, "it retries" is a claim about a mock.
 */
describe('mintStartDocument against a genuinely failing server', () => {
  it('rides out the 502s production actually returned, and comes back with the document', async () => {
    let hits = 0;
    const server = http.createServer((req, res) => {
      hits++;
      if (hits <= 2) { res.writeHead(502); res.end('Bad Gateway'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'abc123', prompt: `open http://x/a/abc123/start?k=zz` }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    const doc = await mintStartDocument(`http://127.0.0.1:${port}`, 'x-driver', { delayMs: 1 });
    expect(doc.id).toBe('abc123');
    expect(hits).toBe(3);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('gives up rather than looping forever when the server never recovers', async () => {
    const server = http.createServer((_req, res) => { res.writeHead(503); res.end(); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    await expect(mintStartDocument(`http://127.0.0.1:${port}`, 'x-driver', { attempts: 2, delayMs: 1 }))
      .rejects.toThrow(/unavailable/);
    await new Promise<void>((r) => server.close(() => r()));
  });

  /** A 4xx is an ANSWER: it must surface at once, not after four rounds of waiting. */
  it('does not retry a 400 — that is the product telling us something', async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => { hits++; res.writeHead(400); res.end(); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    await expect(mintStartDocument(`http://127.0.0.1:${port}`, 'x-driver', { delayMs: 1 })).rejects.toThrow(/400/);
    expect(hits).toBe(1);
    await new Promise<void>((r) => server.close(() => r()));
  });
});
