/**
 * A 500 THAT SAYS NOTHING IS AN OUTAGE WITH NO HANDLE.
 *
 * Left to the framework's default handler, a route that throws answers
 * `500 {}` and puts nothing in the server's log: the gate can say "500", the
 * container's own log says only that it booted, and there is no way in from
 * either end.
 *
 * The caller still learns nothing (an error's text is ours, not theirs); the
 * OPERATOR learns the method, the path and the error.
 */
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountRoutes } from '../api';
import { createAppServer } from '../app';
import { CLI_LAST_SERVICE_VERSION, CLI_RETIREMENT_VERSION, overrideConfig, resetConfigOverrides } from '@/lib/platform/config';

const boom = { GET: () => { throw new Error('the engine is on fire'); } };
const routes = [{ path: '/api/boom', dir: '/api/boom', methods: ['GET'] as const, module: boom }];

afterEach(() => { vi.restoreAllMocks(); resetConfigOverrides(); });

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

describe('the retired CLI installer', () => {
  it('does not serve an executable installer at the retired address', async () => {
    const app = createAppServer({ indexHtml: async () => '<main>app shell</main>' });
    const res = await app.request('/chat/install.sh');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).not.toContain('text/x-shellscript');
    expect(await res.text()).not.toContain('npx --yes @afbin/cli@latest setup');
  });
});

describe('the CLI release pointer', () => {
  it('names the version the CLI retirement switch allows', async () => {
    const app = createAppServer({ indexHtml: async () => '<main>app shell</main>' });
    const pointer = await (await app.request('/chat/release.json')).json() as { version: string; protocol: number };
    expect(pointer.protocol).toBeGreaterThan(0);
    expect(pointer.version, 'off by default: the pointer holds the retirement release, the server names the last service release').toBe(CLI_LAST_SERVICE_VERSION);
    overrideConfig({}, { CLI__RETIREMENT: 'on' });
    const on = await (await app.request('/chat/release.json')).json() as { version: string };
    expect(on.version).toBe(CLI_RETIREMENT_VERSION);
  });
});
