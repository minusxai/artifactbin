import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import { withHttpServer } from '@/__tests__/net';
import { inProcess, overHttp, actorReceiver, actorOf } from '@artifactbin/utils';
import { createProxy } from '../../../proxy/src/parts';
import { testProxyOptions } from '../../../proxy/__tests__/helpers';
import { mountBuildAssets } from '../build-assets';

const prefix = '/api/internal/build-assets';
const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'public-build-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, '.vite')); mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, '.vite/manifest.json'), JSON.stringify({
    main: { file: 'assets/app-abc.js', css: ['assets/app-abc.css'], assets: ['assets/font-abc.woff2'] },
    missing: { file: 'assets/missing-abc.js' },
    forbidden: { file: 'assets/private.html' },
  }));
  for (const [name, body] of [['app-abc.js', 'public code'], ['app-abc.css', 'body{}'], ['font-abc.woff2', 'font'], ['unknown.js', 'not listed'], ['private.html', 'private']]) writeFileSync(path.join(dir, 'assets', name), body);
  const app = new Hono(); mountBuildAssets(app, dir);
  return { app, dir };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('serves only manifest-listed build bytes, with HEAD and immutable caching', async () => {
  const { app } = fixture();
  for (const file of ['app-abc.js', 'app-abc.css', 'font-abc.woff2']) {
    const res = await app.request(prefix + '/assets/' + file);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-artifactbin-build-asset')).toBe('1');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const head = await app.request(prefix + '/assets/' + file, { method: 'HEAD' });
    expect(head.status).toBe(200); expect(await head.text()).toBe('');
    expect(head.headers.get('content-type')).toBe(res.headers.get('content-type'));
  }
});
it('fails closed for unknown/missing files, queries, non-read methods and unsafe paths', async () => {
  const { app, dir } = fixture();
  for (const file of ['unknown.js', 'missing-abc.js', 'private.html', '%61pp-abc.js', '../index.html', 'nested/app-abc.js', 'app-abc.js?private=1']) {
    const res = await app.request(prefix + '/assets/' + file);
    expect(res.status).toBe(404); expect(res.headers.get('x-artifactbin-build-asset')).toBeNull();
  }
  expect((await app.request(prefix + '/assets/app-abc.js', { method: 'POST' })).status).toBe(404);
  rmSync(path.join(dir, '.vite/manifest.json'));
  const noManifest = new Hono(); mountBuildAssets(noManifest, dir);
  expect((await noManifest.request(prefix + '/assets/app-abc.js')).status).toBe(404);
});
it('returns real public build bytes without any identity lookup and keeps protected requests on their usual path', async () => {
  const { app } = fixture();
  app.all('*', c => c.text('protected fallback', 403));
  const session = vi.fn(async () => ({ userId: 'signed-in' }));
  const options = await testProxyOptions({ sessions: { resolve: session }, upstream: inProcess(app) });
  const tokenRead = vi.spyOn(options.tokens, 'byToken');
  const proxy = createProxy(options);
  const res = await proxy.request('/assets/app-abc.js', { headers: { cookie: 'session=secret', authorization: 'Bearer secret', 'x-mx-actor': 'forged' } });
  expect(res.status).toBe(200); expect(await res.text()).toBe('public code');
  expect(session).not.toHaveBeenCalled(); expect(tokenRead).not.toHaveBeenCalled();
  expect(res.headers.get('x-artifactbin-build-asset')).toBeNull();
  for (const url of ['/a/abc123', '/datasets/abc123', '/assets/unknown.js', '/assets/app-abc.js?private=1']) {
    expect((await proxy.request(url)).status).toBe(403);
  }
  expect(session).toHaveBeenCalledTimes(4);
  expect((await proxy.request(prefix + '/assets/app-abc.js')).status).toBe(404);
});

it('preserves the same public-byte boundary over the signed HTTP upstream', async () => {
  const { app } = fixture();
  const outer = new Hono(), secret = 'build-asset-test-secret';
  actorReceiver(secret).mount(outer);
  outer.use('*', async (c, next) => {
    expect(actorOf(c.req.raw)).toEqual({ credential: 'none' });
    expect(c.req.header('cookie')).toBeUndefined(); expect(c.req.header('authorization')).toBeUndefined();
    await next();
  });
  outer.route('/', app);
  const server = await withHttpServer(getRequestListener(outer.fetch));
  try {
    const session = vi.fn(async () => { throw Error('identity unavailable'); });
    const proxy = createProxy(await testProxyOptions({ sessions: { resolve: session }, upstream: overHttp(server.base, secret), upstreamDeadlineMs: 1000 }));
    for (const method of ['GET', 'HEAD']) {
      const res = await proxy.request('/assets/app-abc.js', { method, headers: { cookie: 'secret', authorization: 'Bearer secret', 'x-mx-actor': 'forged' } });
      expect(res.status).toBe(200); expect(await res.text()).toBe(method === 'HEAD' ? '' : 'public code');
      expect(res.headers.get('cache-control')).toContain('immutable');
    }
    expect(session).not.toHaveBeenCalled();
  } finally { await server.close(); }
});
