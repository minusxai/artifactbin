/**
 * URL → stored image artifact content: the web-ingest fetcher composed with
 * the SAME storeImageContent every upload path runs, so the caps and the type
 * policy cannot fork. What this file owns: the type comes from the BYTES (a
 * lying Content-Type header changes nothing), refusals are actionable
 * Responses, and provenance (the source URL) rides the meta.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setWebIngestPolicyForTests } from '../fetch';
import { ingestImageFromUrl } from '../image';
import { withHttpServer, type RunningServer } from '@/__tests__/net';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let server: RunningServer;
let base: string;

beforeAll(async () => {
  server = await withHttpServer((req, res) => {
    switch (req.url) {
      case '/real.png':
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(PNG);
        return;
      case '/lying-header.txt':
        // Text header, png bytes: the bytes win.
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(PNG);
        return;
      case '/error-page.png':
        // Image URL serving an html error page: refused by the sniff.
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end('<!doctype html><html><body>404</body></html>');
        return;
      case '/gone.png':
        res.writeHead(404);
        res.end();
        return;
      default:
        res.writeHead(500);
        res.end();
    }
  });
  base = server.base;
  setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
});

afterAll(async () => {
  setWebIngestPolicyForTests(null);
  await server.close();
});

afterEach(() => setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true }));

describe('ingestImageFromUrl', () => {
  it('stores the bytes typed by their magic, with the source URL as provenance', async () => {
    const stored = await ingestImageFromUrl(`${base}/real.png`);
    expect(stored instanceof Response).toBe(false);
    if (stored instanceof Response) return;
    expect(stored.format).toBe('image');
    expect(stored.meta.contentType).toBe('image/png');
    expect(stored.meta.sourceUrl).toBe(`${base}/real.png`);
    expect(stored.meta.objectKey).toBeTruthy();
  });

  it('types by the BYTES when the remote header lies', async () => {
    const stored = await ingestImageFromUrl(`${base}/lying-header.txt`);
    if (stored instanceof Response) throw new Error('refused');
    expect(stored.meta.contentType).toBe('image/png');
  });

  it('refuses an html error page served under an image URL', async () => {
    const res = await ingestImageFromUrl(`${base}/error-page.png`);
    expect(res instanceof Response).toBe(true);
    if (!(res instanceof Response)) return;
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('image_fetch_failed');
    expect(String(body.details)).toContain('not an image');
  });

  it('turns fetch refusals into 400s that NAME the url and the reason', async () => {
    const res = await ingestImageFromUrl(`${base}/gone.png`);
    if (!(res instanceof Response)) throw new Error('should refuse');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('image_fetch_failed');
    expect(body.code).toBe('bad_status');
    expect(String(body.details)).toContain('/gone.png');
  });

  it('refuses a forbidden target with the guard, never a socket', async () => {
    setWebIngestPolicyForTests(null); // strict production policy
    const res = await ingestImageFromUrl('https://169.254.169.254/latest/meta-data');
    if (!(res instanceof Response)) throw new Error('should refuse');
    expect((await res.json()).code).toBe('forbidden_address');
  });
});
