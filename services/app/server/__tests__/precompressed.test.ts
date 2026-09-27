/**
 * PRECOMPRESSED STATIC TREES, over a real socket — the bytes on the wire are the
 * point, and a test that reads a Response object sees them decoded or not at all.
 *
 * Every door that serves a content-addressed file answers with the best
 * variant the request's Accept-Encoding allows: the brotli or gzip sibling the
 * build wrote beside it, under the original's content type, with its own
 * length and `Vary: Accept-Encoding`. Range, HEAD and cache headers behave as
 * they did; a sibling is never addressable on its own.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import { readRawResponse, withHttpServer, type RunningServer } from '@artifactbin/test-support/net';
import { actorReceiver, inProcess, overHttp } from '@artifactbin/utils';
import { createAuthHost } from '@artifactbin/auth';
import { testAuthOptions } from '../../../auth/__tests__/helpers';
import { mountBuildAssets } from '../build-assets';
import { precompressedStatic } from '../content-encoding';

const BROWSER = 'gzip, deflate, br, zstd';
const CODE = 'export const words = "' + 'a sentence the build compresses well. '.repeat(300) + '";\n';
const dirs: string[] = [];
const servers: RunningServer[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.close(); });
afterAll(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A tree with one precompressed file, one without siblings, and a build manifest. */
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'precompressed-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'story')); mkdirSync(path.join(dir, 'assets')); mkdirSync(path.join(dir, '.vite'));
  for (const file of ['story/entry-abc.js', 'assets/app-abc.js']) {
    writeFileSync(path.join(dir, file), CODE);
    writeFileSync(path.join(dir, file + '.br'), brotliCompressSync(Buffer.from(CODE)));
    writeFileSync(path.join(dir, file + '.gz'), gzipSync(Buffer.from(CODE), { level: 9 }));
  }
  writeFileSync(path.join(dir, 'story/plain-abc.js'), CODE);
  writeFileSync(path.join(dir, '.vite/manifest.json'), JSON.stringify({ main: { file: 'assets/app-abc.js' } }));
  return { dir, br: readFileSync(path.join(dir, 'story/entry-abc.js.br')), gz: readFileSync(path.join(dir, 'story/entry-abc.js.gz')) };
}
const listen = async (app: { fetch: (request: Request) => Response | Promise<Response> }) => {
  const server = await withHttpServer(getRequestListener(app.fetch));
  servers.push(server);
  return server;
};
const varyOf = (headers: Record<string, unknown>) => String(headers.vary ?? '').toLowerCase();

describe('precompressedStatic', () => {
  let tree: ReturnType<typeof fixture>;
  let server: RunningServer;
  beforeAll(async () => {
    tree = fixture();
    const app = new Hono();
    app.use('/*', precompressedStatic({ root: path.relative(process.cwd(), tree.dir) }));
    server = await withHttpServer(getRequestListener(app.fetch));
  });
  afterAll(async () => { await server.close(); });

  it('answers brotli when accepted, as the sibling bytes under the original type and length', async () => {
    const res = await readRawResponse(server.port, '/story/entry-abc.js', { headers: { 'accept-encoding': BROWSER } });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.headers['content-type']).toMatch(/^text\/javascript/);
    expect(varyOf(res.headers)).toContain('accept-encoding');
    expect(res.promised).toBe(tree.br.byteLength);
    expect(Buffer.compare(res.body, tree.br)).toBe(0);
  });
  it('answers gzip when that is all the client takes, and honours a refusal of brotli', async () => {
    for (const accept of ['gzip', 'br;q=0, gzip']) {
      const res = await readRawResponse(server.port, '/story/entry-abc.js', { headers: { 'accept-encoding': accept } });
      expect(res.headers['content-encoding'], accept).toBe('gzip');
      expect(Buffer.compare(res.body, tree.gz), accept).toBe(0);
      expect(res.promised, accept).toBe(tree.gz.byteLength);
    }
  });
  it('answers identity to a client that takes no encoding, still varying on it', async () => {
    for (const headers of [{}, { 'accept-encoding': 'identity' }] as Record<string, string>[]) {
      const res = await readRawResponse(server.port, '/story/entry-abc.js', { headers });
      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(varyOf(res.headers)).toContain('accept-encoding');
      expect(res.body.toString()).toBe(CODE);
      expect(res.promised).toBe(Buffer.byteLength(CODE));
    }
  });
  it('answers HEAD with the chosen variant\'s headers and no body', async () => {
    const res = await readRawResponse(server.port, '/story/entry-abc.js', { method: 'HEAD', headers: { 'accept-encoding': BROWSER } });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.promised).toBe(tree.br.byteLength);
    expect(res.body.byteLength).toBe(0);
  });
  it('keeps Range on the identity bytes, exactly as before', async () => {
    const res = await readRawResponse(server.port, '/story/entry-abc.js', { headers: { 'accept-encoding': BROWSER, range: 'bytes=0-9' } });
    expect(res.status).toBe(206);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['content-range']).toBe(`bytes 0-9/${Buffer.byteLength(CODE)}`);
    expect(res.body.toString()).toBe(CODE.slice(0, 10));
  });
  it('serves a file with no siblings as it is, and never a sibling on its own', async () => {
    const plain = await readRawResponse(server.port, '/story/plain-abc.js', { headers: { 'accept-encoding': BROWSER } });
    expect(plain.status).toBe(200);
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body.toString()).toBe(CODE);
    for (const sibling of ['/story/entry-abc.js.br', '/story/entry-abc.js.gz']) {
      expect((await readRawResponse(server.port, sibling, { headers: { 'accept-encoding': BROWSER } })).status, sibling).toBe(404);
    }
  });
});

describe('the build-asset door, direct and through the auth host', () => {
  it('serves the brotli sibling of a manifest-listed asset through the app, in-process and over HTTP', async () => {
    const tree = fixture();
    const br = readFileSync(path.join(tree.dir, 'assets/app-abc.js.br'));
    const app = new Hono(); mountBuildAssets(app, tree.dir);
    app.all('*', c => c.text('protected fallback', 403));
    const secret = 'precompressed-test-secret-000000000';
    const outer = new Hono(); actorReceiver(secret).mount(outer); outer.route('/', app);
    const appServer = await listen(outer);
    const session = vi.fn(async () => null);
    const doors = {
      app: appServer,
      inProcess: await listen(createAuthHost(await testAuthOptions({ sessions: { resolve: session }, upstream: inProcess(app) }))),
      overHttp: await listen(createAuthHost(await testAuthOptions({ sessions: { resolve: session }, upstream: overHttp(appServer.base, secret) }))),
    };
    for (const [door, server] of Object.entries(doors)) {
      const path = door === 'app' ? '/api/internal/build-assets/assets/app-abc.js' : '/assets/app-abc.js';
      const res = await readRawResponse(server.port, path, { headers: { 'accept-encoding': BROWSER } });
      expect(res.status, door).toBe(200);
      expect(res.headers['content-encoding'], door).toBe('br');
      expect(res.headers['cache-control'], door).toBe('public, max-age=31536000, immutable');
      expect(varyOf(res.headers), door).toContain('accept-encoding');
      expect(res.promised, door).toBe(br.byteLength);
      expect(Buffer.compare(res.body, br), door).toBe(0);
      const plain = await readRawResponse(server.port, path);
      expect(plain.headers['content-encoding'], door).toBeUndefined();
      expect(plain.body.toString(), door).toBe(CODE);
    }
    expect(session).not.toHaveBeenCalled();
  });
});
