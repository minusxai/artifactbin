/**
 * A ROUTE'S HEADER OBJECT IS NOT A CONSTANT — the server writes into it.
 *
 * `@hono/node-server` writes the computed `Content-Length` back INTO the very
 * headers object a route handed to `new Response(body, { headers })`. A route
 * that shares one module-level object across its responses therefore announces
 * the FIRST body's length forever after: every later response is truncated or
 * padded to a length that has nothing to do with it, and a browser drops it
 * with `net::ERR_CONTENT_LENGTH_MISMATCH` — while curl, which reads what it is
 * given, shows a perfectly good body.
 *
 * That is how it was found: live updates stopped adopting, because the frame
 * every reader fetches after a version ping is exactly such a route, and its
 * fetch rejected in the browser and nowhere else.
 *
 * The test goes over a REAL socket, because the mutation happens in the
 * writer, not in the handler — a route tested by calling its exported function
 * cannot see it.
 */
import http from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { describe, expect, it } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';


import { mintToken } from '@/lib/tokens';
import { createAppServer } from '../app';
import { useAppHarness } from '@/__tests__/harness';
import { withHttpServer } from '@/__tests__/net';

useAppHarness();

const BASE = 'http://localhost:3000';

/** What actually came down the socket, with the length the server promised. */
function raw(port: number, path: string): Promise<{ promised: number | null; bytes: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const cl = res.headers['content-length'];
        resolve({ promised: cl === undefined ? null : Number(cl), bytes: body.byteLength, body: body.toString('utf8') });
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

describe('what the server promises is what it sends', () => {
  it('answers two DIFFERENT documents with two different content-lengths', async () => {
    const t = await mintToken('t');
    const create = async (markup: string) => (await (await createArtifactRoute(new Request(`${BASE}/api/artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${t.token}` },
      body: JSON.stringify({ title: 'x', markup, visibility: 'public' }),
    }))).json()) as { id: string };

    const small = await create('<div><p>small</p></div>');
    const big = await create(`<div><p>${'much longer text '.repeat(400)}</p></div>`);

    const app = createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>' });
    const server = await withHttpServer(getRequestListener(app.fetch));
    try {
      // The order is the point: the SECOND response is the one that inherits a
      // stale length. Both are checked, so neither direction can hide it.
      for (const id of [small.id, big.id, small.id]) {
        const res = await raw(server.port, `/a/${id}/events/frame`);
        expect(res.promised, `content-length for ${id}`).toBe(res.bytes);
        expect(() => JSON.parse(res.body), `parseable frame for ${id}`).not.toThrow();
      }
    } finally {
      await server.close();
    }
  }, 30_000);
});
