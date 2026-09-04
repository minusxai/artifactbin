/**
 * A PDF over a REAL SOCKET — because the parts of this that can go wrong are in
 * the writer, not in the handler.
 *
 * Two of them, both established in this repo the hard way:
 *  - `@hono/node-server` writes the computed `Content-Length` back INTO the
 *    headers object a route hands it (server/__tests__/content-length.test.ts).
 *    A 206 sets its OWN length, and a route that returns a STREAM has no length
 *    to compute — so what the socket actually announces for a range is a
 *    question only the socket can answer.
 *  - the body is a Node stream converted to a web ReadableStream. Whether that
 *    reaches the wire whole, and whether a 206 keeps its status through the
 *    adapter, is likewise invisible to a test that calls GET() and reads the
 *    Response it was handed.
 */
import http from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { describe, expect, it } from 'vitest';
import { samplePdf, samplePdfDataUrl } from '../../../../scripts/lib/sample-pdf.mjs';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { mintToken } from '@/lib/tokens';
import { createAppServer } from '../app';
import { request, useAppHarness } from '@/__tests__/harness';
import { withHttpServer } from '@/__tests__/net';

useAppHarness();

interface Wire { status: number; headers: http.IncomingHttpHeaders; body: Buffer }

const fetchRaw = (port: number, path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Wire> =>
  new Promise((resolve, reject) => {
    http.request({ host: '127.0.0.1', port, path, headers, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    }).on('error', reject).end();
  });

describe('a PDF as the socket actually writes it', () => {
  it('streams the whole file, and one range of it, with the lengths it promised', async () => {
    const t = await mintToken('t');
    const created = await createArtifactRoute(request('/api/artifacts', {
      method: 'POST', token: t.token, json: { title: 'Wire paper', pdf: samplePdfDataUrl(3), visibility: 'public' },
    }));
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    const whole = samplePdf(3);

    const app = createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>' });
    const server = await withHttpServer(getRequestListener(app.fetch));
    try {
      const full = await fetchRaw(server.port, `/a/${id}/raw`);
      expect(full.status).toBe(200);
      expect(full.headers['content-type']).toBe('application/pdf');
      expect(full.headers['content-disposition']).toBe('inline; filename="Wire paper.pdf"');
      expect(full.headers['content-security-policy']).toBe('sandbox');
      expect(full.headers['x-content-type-options']).toBe('nosniff');
      expect(full.headers['accept-ranges']).toBe('bytes');
      // The whole file arrived, and the length announced is the length sent.
      expect(Buffer.compare(full.body, whole)).toBe(0);
      expect(Number(full.headers['content-length'])).toBe(full.body.byteLength);

      const part = await fetchRaw(server.port, `/a/${id}/raw`, { range: 'bytes=100-199' });
      expect(part.status).toBe(206);
      expect(part.headers['content-range']).toBe(`bytes 100-199/${whole.byteLength}`);
      expect(Number(part.headers['content-length'])).toBe(100);
      expect(Buffer.compare(part.body, whole.subarray(100, 200))).toBe(0);

      // A second range on the same keep-alive server: the first response's
      // length must not have been written into anything the second one reuses.
      const tail = await fetchRaw(server.port, `/a/${id}/raw`, { range: 'bytes=-16' });
      expect(tail.status).toBe(206);
      expect(Number(tail.headers['content-length'])).toBe(16);
      expect(Buffer.compare(tail.body, whole.subarray(whole.byteLength - 16))).toBe(0);

      // …and the whole file again, after both, still announces its own size.
      const again = await fetchRaw(server.port, `/a/${id}/raw`);
      expect(again.status).toBe(200);
      expect(Number(again.headers['content-length'])).toBe(whole.byteLength);

      const head = await fetchRaw(server.port, `/a/${id}/raw`, {}, 'HEAD');
      expect(head.status).toBe(200);
      expect(head.headers['content-type']).toBe('application/pdf');
      expect(head.body.byteLength).toBe(0);
    } finally {
      await server.close();
    }
  }, 30_000);
});
