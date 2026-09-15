/**
 * The dev server's bindings, all derived so two checkouts can run at once:
 * the port (PORT → the port inside PUBLIC_BASE_URL → 3030), the HMR websocket
 * port beside it, and the Vite options that must not share a cache directory.
 */
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveHmrPort } from '@/lib/config';
import { developmentShowcaseProxy, developmentViteOptions } from '../dev-vite';
import { SHOWCASE } from '../showcase';
import { resolvePort, DEFAULT_DEV_PORT } from '../../../../scripts/lib/dev-env.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('resolvePort', () => {
  it('takes the port out of PUBLIC_BASE_URL', () => {
    expect(resolvePort({ APP__PUBLIC_BASE_URL: 'http://localhost:3040' })).toBe(3040);
  });

  it('lets PORT win over PUBLIC_BASE_URL', () => {
    expect(resolvePort({ APP__PORT: '3050', APP__PUBLIC_BASE_URL: 'http://localhost:3030' })).toBe(3050);
  });

  it('falls back to 3030 when nothing is set', () => {
    expect(resolvePort({})).toBe(DEFAULT_DEV_PORT);
    expect(DEFAULT_DEV_PORT).toBe(3030);
  });

  it('does NOT infer a port from a URL scheme default', () => {
    // A production PUBLIC_BASE_URL carries no port — binding 443 would be absurd.
    expect(resolvePort({ APP__PUBLIC_BASE_URL: 'https://artifactbin.dev' })).toBe(3030);
    expect(resolvePort({ APP__PUBLIC_BASE_URL: 'http://localhost' })).toBe(3030);
  });

  it('ignores junk rather than crashing', () => {
    expect(resolvePort({ APP__PUBLIC_BASE_URL: 'not a url' })).toBe(3030);
    expect(resolvePort({ APP__PORT: 'abc', APP__PUBLIC_BASE_URL: 'http://localhost:3040' })).toBe(3040);
    expect(resolvePort({ APP__PORT: '0' })).toBe(3030);
    expect(resolvePort({ APP__PORT: '99999' })).toBe(3030);
  });
});

describe('resolveHmrPort — Vite HMR websocket port beside the app port', () => {
  it('defaults to the app port + 1, so two checkouts never share Vite\'s 24678', () => {
    expect(resolveHmrPort(undefined, 3050)).toBe(3051);
    expect(resolveHmrPort('', 3030)).toBe(3031);
  });
  it('honours an explicit APP__HMR_PORT', () => {
    expect(resolveHmrPort('24999', 3050)).toBe(24999);
  });
  it('falls back to the default on a value that is not a port', () => {
    expect(resolveHmrPort('abc', 3050)).toBe(3051);
    expect(resolveHmrPort('0', 3050)).toBe(3051);
  });
});

describe('developmentViteOptions', () => {
  it('scans an existing entry relative to the Vite web root', () => {
    for (const entry of developmentViteOptions(appRoot, 7242).optimizeDeps.entries)
      expect(existsSync(path.resolve(appRoot, 'web', entry))).toBe(true);
  });
  it('keeps separate dev servers from replacing each other’s optimized dependencies', () => {
    expect(developmentViteOptions(appRoot, 7242).cacheDir).not.toBe(developmentViteOptions(appRoot, 7284).cacheDir);
  });
});

describe('development showcase proxy', () => {
  it('serves redirected image bytes without forwarding viewer credentials or crashing', async () => {
    const seen: { cookie?: string; authorization?: string }[] = [];
    const upstream = createServer((req, res) => {
      seen.push({ cookie: req.headers.cookie, authorization: req.headers.authorization });
      if (req.url?.startsWith('/a/')) {
        res.writeHead(302, { location: '/image.jpg' });
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'image/jpeg' });
        res.end('fixture-image');
      }
    });
    const listen = async (server: Server) => {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      return `http://127.0.0.1:${address.port}`;
    };
    const close = (server: Server) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const target = await listen(upstream);
    const proxy = developmentShowcaseProxy();
    Object.values(proxy)[0]!.target = target;
    const vite = await createViteServer({ configFile: false, server: { middlewareMode: true, hmr: false, proxy } });
    const local = createServer(vite.middlewares);
    try {
      const origin = await listen(local);
      const response = await fetch(`${origin}/__dev/showcase/a/${SHOWCASE[0]!.id}/export?format=jpg&mode=card`, {
        redirect: 'manual', headers: { cookie: 'session=test-only', authorization: 'Bearer test-only' },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/jpeg');
      expect(await response.text()).toBe('fixture-image');
      expect(seen).toEqual([{}, {}]);
    } finally {
      await close(local);
      await vite.close();
      await close(upstream);
    }
  });
  it('proxies only curated export paths to the canonical origin', () => {
    const [pattern, config] = Object.entries(developmentShowcaseProxy())[0]!;
    const accepts = new RegExp(pattern);
    for (const doc of SHOWCASE) expect(accepts.test(`/__dev/showcase/a/${doc.id}/export?format=jpg&mode=card`)).toBe(true);
    for (const url of ['/__dev/showcase/a/secret/export', '/__dev/showcase/api/account', '/__dev/showcase/a/7KRGdj/raw']) expect(accepts.test(url)).toBe(false);
    expect(config.target).toBe('https://artifactbin.dev');
    // Asset-host redirects must resolve inside the proxy so CSP and WebGL
    // still receive a same-origin image response.
    expect(config.followRedirects).toBe(true);
    expect(config.rewrite!('/__dev/showcase/a/7KRGdj/export?format=jpg&mode=card')).toBe('/a/7KRGdj/export?format=jpg&mode=card');
  });
});
