/**
 * The guarded fetcher against a REAL local http server — sockets, redirects,
 * streaming, aborts. The loopback address it binds is exactly what the strict
 * policy forbids, which is itself the first assertion: with no test override,
 * the fetcher refuses this server before a single byte moves. Everything else
 * runs under the explicit test policy, the same seam dev deployments use
 * (WEB_INGEST_ALLOW_PRIVATE).
 */
import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import { fetchWebResource, setWebIngestPolicyForTests } from '../fetch';
import { WebIngestError } from '../guard';
import { withHttpServer, type RunningServer } from '@/__tests__/net';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let server: RunningServer;
let base: string;

beforeAll(async () => {
  server = await withHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    switch (url.pathname) {
      case '/ok.png':
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(PNG);
        return;
      case '/redirect':
        res.writeHead(302, { Location: '/ok.png' });
        res.end();
        return;
      case '/redirect-absolute':
        res.writeHead(301, { Location: `${base}/ok.png` });
        res.end();
        return;
      case '/one-write-too-big':
        // A whole oversized body in ONE chunk — small enough that node hands it
        // over as a single `data` event and the response is COMPLETE by the
        // time the cap trips. /big streams and destroys mid-response, which is
        // a different path in node and the reason this went unnoticed.
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.end(Buffer.alloc(8 * 1024, 0x20));
        return;
      case '/loop':
        res.writeHead(302, { Location: '/loop' });
        res.end();
        return;
      case '/redirect-private':
        // The classic second-hop escape: a public host answering with a
        // redirect INTO the private network. The guard must run per hop.
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
        res.end();
        return;
      case '/big': {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        // Stream forever-ish; the fetcher must abort at its cap, not buffer this.
        const chunk = Buffer.alloc(64 * 1024);
        let sent = 0;
        const push = () => {
          if (sent > 50 * 1024 * 1024 || res.destroyed) { res.end(); return; }
          sent += chunk.length;
          if (res.write(chunk)) setImmediate(push);
          else res.once('drain', push);
        };
        push();
        return;
      }
      case '/slow':
        // Headers, then silence — the deadline must fire mid-body too.
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return;
      case '/missing':
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<html>gone</html>');
        return;
      default:
        res.writeHead(500);
        res.end();
    }
  });
  base = server.base;
});

afterAll(async () => {
  await server.close();
});

afterEach(() => setWebIngestPolicyForTests(null));

const lax = () => setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
const code = async (p: Promise<unknown>): Promise<string> => {
  try { await p; return 'NO_ERROR'; } catch (e) { return e instanceof WebIngestError ? e.code : `OTHER:${e}`; }
};

describe('fetchWebResource', () => {
  it('refuses this very server under the default policy — on the SCHEME, before any socket', async () => {
    // http dies first; https to the same loopback would die on the address
    // (the dedicated forbidden_address cases below prove that rule).
    expect(await code(fetchWebResource(`${base}/ok.png`, { maxBytes: 1000 }))).toBe('forbidden_scheme');
  });

  it('fetches bytes, reports the content type and the final URL', async () => {
    lax();
    const got = await fetchWebResource(`${base}/ok.png`, { maxBytes: 1000 });
    expect(got.bytes.equals(PNG)).toBe(true);
    expect(got.contentType).toBe('image/png');
    expect(got.finalUrl).toBe(`${base}/ok.png`);
  });

  it('follows relative and absolute redirects, re-guarding each hop', async () => {
    lax();
    expect((await fetchWebResource(`${base}/redirect`, { maxBytes: 1000 })).bytes.equals(PNG)).toBe(true);
    expect((await fetchWebResource(`${base}/redirect-absolute`, { maxBytes: 1000 })).finalUrl).toBe(`${base}/ok.png`);
  });

  it('refuses a redirect into the private network EVEN under a public-only policy', async () => {
    // allowHttp so the first (loopback) hop is reachable in the test, but
    // private addresses stay forbidden: the second hop must die on the guard.
    setWebIngestPolicyForTests({ allowPrivate: false, allowHttp: true });
    // First hop is loopback too, so this refuses immediately — which is the
    // point; the dedicated second-hop case needs the lax first hop:
    expect(await code(fetchWebResource(`${base}/redirect-private`, { maxBytes: 1000 }))).toBe('forbidden_address');
  });

  it('a lax first hop still cannot redirect to the metadata IP when the target is checked per hop', async () => {
    // allowPrivate admits loopback; 169.254.169.254 is link-local, which the
    // policy keeps forbidden even in dev — the metadata IP never softens.
    lax();
    expect(await code(fetchWebResource(`${base}/redirect-private`, { maxBytes: 1000 }))).toBe('forbidden_address');
  });

  it('gives up on a redirect loop', async () => {
    lax();
    expect(await code(fetchWebResource(`${base}/loop`, { maxBytes: 1000 }))).toBe('too_many_redirects');
  });

  it('aborts a stream past maxBytes instead of buffering it', async () => {
    lax();
    const started = Date.now();
    expect(await code(fetchWebResource(`${base}/big`, { maxBytes: 256 * 1024 }))).toBe('too_large');
    expect(Date.now() - started).toBeLessThan(10_000); // died at the cap, not at 50 MB
  });

  it('rejects an oversized body that arrived in ONE write, without raising an uncaught exception', async () => {
    /*
     * Two faults, one line, and both only when the body arrives in a single
     * chunk. `req.destroy(err)` on a request whose response has already
     * COMPLETED does not emit that error on the request — node raises it, and
     * an uncaught exception in a server is the process — and the early
     * `return` from the data handler then let `end` fire and RESOLVE the
     * fetch with the bytes collected so far, so the caller was handed a
     * truncated body (empty, here) and answered "not a PDF" for a file that
     * was simply too big. Measured with an 8 KB body against a 1 KB cap:
     * `-> end, uncaught+1`. The streaming case above destroys mid-response and
     * was always correct, which is why this went unnoticed. The abort now
     * destroys WITHOUT an error and rejects by hand.
     */
    lax();
    const raised: Error[] = [];
    const watch = (error: Error) => raised.push(error);
    process.on('uncaughtException', watch);
    try {
      expect(await code(fetchWebResource(`${base}/one-write-too-big`, { maxBytes: 1_000 }))).toBe('too_large');
      await new Promise((r) => setTimeout(r, 50)); // let a late throw land
    } finally {
      process.off('uncaughtException', watch);
    }
    expect(raised.map((e) => e.message)).toEqual([]);
  });

  it('enforces the deadline mid-body', async () => {
    lax();
    expect(await code(fetchWebResource(`${base}/slow`, { maxBytes: 1000, timeoutMs: 500 }))).toBe('timeout');
  });

  it('reports a non-200 as bad_status, body unread', async () => {
    lax();
    expect(await code(fetchWebResource(`${base}/missing`, { maxBytes: 1000 }))).toBe('bad_status');
  });

  it('honors an allowHosts narrowing on every hop', async () => {
    lax();
    const only = (h: string) => h === 'nope.example';
    expect(await code(fetchWebResource(`${base}/ok.png`, { maxBytes: 1000, allowHosts: only }))).toBe('forbidden_host');
  });

  it('connects through a NAMED host — the guarded lookup path', async () => {
    // A literal 127.0.0.1 skips DNS entirely, so every other case in this file
    // leaves `guardedLookup` unexercised. That is how a real bug shipped: with
    // Node's autoSelectFamily the socket calls lookup with `all: true` and
    // expects the ARRAY back; answering with one address failed every named
    // host with "Invalid IP address: undefined" while these tests stayed green.
    lax();
    const named = base.replace('127.0.0.1', 'localhost');
    const got = await fetchWebResource(`${named}/ok.png`, { maxBytes: 1000 });
    expect(got.bytes.equals(PNG)).toBe(true);
  });

  it('refuses an unresolvable name as dns_failed', async () => {
    lax();
    expect(await code(fetchWebResource('https://definitely-not-a-real-host.invalid/x', { maxBytes: 1000 }))).toBe('dns_failed');
  });
});
