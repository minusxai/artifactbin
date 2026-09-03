/**
 * Retrying the DRIVER's own setup, so a blip does not cost a paid agent run.
 */
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { isTransientStatus, mintStartDocument, mintStartDocumentAs, withRetry } from '../lib/retry';

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

/**
 * A leg with an ACCOUNT credential does not spend `/api/start` — that mints an ANONYMOUS token, and
 * the whole point is that the agent's documents belong to the eval's account. The driver creates the
 * start document itself, as that account, and the ledger skips the call (`DRIVER_HEADER`).
 */
describe('mintStartDocumentAs — the account-owned start document', () => {
  it('creates an unlisted placeholder as the account, marked as the driver’s own call', async () => {
    const seen: { auth: string | undefined; driver: string | undefined; body: unknown }[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.push({ auth: req.headers.authorization, driver: req.headers['x-driver'] as string, body: JSON.parse(body) });
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'acct01', url: 'http://x/a/acct01', visibility: 'unlisted' }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    const doc = await mintStartDocumentAs(`http://127.0.0.1:${port}`, 'x-driver', 'mx_account', { delayMs: 1 });
    expect(doc.id).toBe('acct01');
    expect(seen).toHaveLength(1);
    expect(seen[0].auth).toBe('Bearer mx_account');
    expect(seen[0].driver).toBe('1');
    expect(seen[0].body).toMatchObject({ visibility: 'unlisted' });
    // Placeholder markup, so `published` still compares the agent's document against a document it did not write.
    expect(String((seen[0].body as { markup: string }).markup).length).toBeGreaterThan(0);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('rides out a 502 the same way the anonymous mint does, and surfaces a 4xx at once', async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits++;
      if (hits === 1) { res.writeHead(502); res.end(); return; }
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'acct02' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    expect((await mintStartDocumentAs(`http://127.0.0.1:${port}`, 'x-driver', 'mx_account', { delayMs: 1 })).id).toBe('acct02');
    expect(hits).toBe(2);
    await new Promise<void>((r) => server.close(() => r()));

    const refusing = http.createServer((_req, res) => { res.writeHead(403); res.end(); });
    await new Promise<void>((r) => refusing.listen(0, '127.0.0.1', r));
    const p2 = (refusing.address() as { port: number }).port;
    await expect(mintStartDocumentAs(`http://127.0.0.1:${p2}`, 'x-driver', 'mx_account', { delayMs: 1 })).rejects.toThrow(/403/);
    await new Promise<void>((r) => refusing.close(() => r()));
  });
});
