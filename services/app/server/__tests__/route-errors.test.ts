/**
 * A 500 THAT SAYS NOTHING IS AN OUTAGE WITH NO HANDLE.
 *
 * A route that throws became `500 {}` with nothing in the server's log: the
 * framework's default handler answers and swallows. That is what a container
 * looked like when `/api/start` failed inside the image — the gate could say
 * "500", the container's own log said only that it had booted, and there was
 * no way in from either end.
 *
 * The caller still learns nothing (an error's text is ours, not theirs); the
 * OPERATOR learns the method, the path and the error.
 */
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountRoutes } from '../api';
import { createAppServer } from '../app';

const boom = { GET: () => { throw new Error('the engine is on fire'); } };
const routes = [{ path: '/api/boom', dir: '/api/boom', methods: ['GET'] as const, module: boom }];

afterEach(() => { vi.restoreAllMocks(); });

describe('a route that throws', () => {
  it('is logged with its method and path, and answers without them', async () => {
    const logged: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args); });

    const app = new Hono();
    mountRoutes(app, routes as unknown as Parameters<typeof mountRoutes>[1]);
    const res = await app.request('/api/boom');

    expect(res.status).toBe(500);
    expect(await res.text(), 'the caller is told nothing about our internals').not.toContain('on fire');

    const line = logged.map((a) => a.map(String).join(' ')).join('\n');
    expect(line, 'the operator is told everything').toContain('GET');
    expect(line).toContain('/api/boom');
    expect(line).toContain('the engine is on fire');
  });
});

describe('the token mint page', () => {
  it('serves the CLI installer as shell text ahead of profile routing', async () => {
    const app = createAppServer({ indexHtml: async () => '<main>app shell</main>' });
    const res = await app.request('/chat/install.sh');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/x-shellscript');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toContain('afbin-$platform-$arch');
  });
  it('serves /tokens/new as a successful SPA page ahead of catch-all routing', async () => {
    const app = createAppServer({ indexHtml: async () => '<!doctype html><main>app shell</main>' });
    const res = await app.request('/tokens/new');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('app shell');
  });
});
