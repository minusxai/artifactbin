/**
 * GET /api/health — readiness for the WHOLE stack, blind on the wire.
 *
 * `/health` on every process is that process's own liveness; nothing said
 * whether a user could be served. This URL does: under `/api/` the proxy has
 * already forwarded and the app has already answered, and the handler adds
 * the hop the app owns — sql, browser and events on their own `/health`.
 * The body is `{ok}` and nothing else: which service failed is the
 * operator's business (one log line), not the public's (topology).
 *
 * Seeded RED by the orchestrator.
 */
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from '@/__tests__/harness';
import { GET as apiHealth } from '@/app/api/health/route';
import { stackHealth } from '@/lib/health';

/** What `@/lib/config` answers for the three URLs in THIS file — live, so one file covers both outcomes. */
const urls: { sql?: string; browser?: string; events?: string } = {};
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  get SQL_SERVICE_URL() { return urls.sql; },
  get BROWSER_SERVICE_URL() { return urls.browser; },
  get EVENTS_SERVICE_URL() { return urls.events; },
}));

const servers: Server[] = [];
const seen: Array<Record<string, string | string[] | undefined>> = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((resolve) => s.close(() => resolve(null)));
  seen.length = 0;
  delete urls.sql; delete urls.browser; delete urls.events;
  vi.restoreAllMocks();
});

/** A throwaway service whose `/health` answers `status` after `delayMs`. */
async function serve(status: number, delayMs = 0): Promise<string> {
  const s = createServer((req, res) => {
    seen.push(req.headers);
    setTimeout(() => { res.statusCode = req.url === '/health' ? status : 404; res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); }, delayMs);
  });
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()));
  servers.push(s);
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}

describe('stackHealth', () => {
  it('in-process everywhere (no URLs) is healthy without a single probe', async () => {
    expect(await stackHealth({ sql: null, browser: null, events: null })).toEqual({ ok: true, failing: [] });
    expect(seen).toHaveLength(0);
  });
  it('probes each configured service on /health and names the ones that fail: a non-2xx, a refused connection', async () => {
    const good = await serve(200);
    const bad = await serve(500);
    expect(await stackHealth({ sql: good, browser: bad, events: 'http://127.0.0.1:9' })).toEqual({ ok: false, failing: ['browser', 'events'] });
    expect(await stackHealth({ sql: good, browser: good, events: good })).toEqual({ ok: true, failing: [] });
  });
  it('a service that does not answer within the deadline is down, not a hang — and the probes run in parallel', async () => {
    const slow = await serve(200, 4000);
    const started = Date.now();
    expect(await stackHealth({ sql: slow, browser: slow, events: slow })).toEqual({ ok: false, failing: ['sql', 'browser', 'events'] });
    expect(Date.now() - started).toBeLessThan(3500);
  });
  it('carries no credential on the probe: every service answers /health before its secret check', async () => {
    const good = await serve(200);
    await stackHealth({ sql: good, browser: null, events: null });
    expect(seen).toHaveLength(1);
    for (const name of Object.keys(seen[0]!)) expect(name.toLowerCase()).not.toMatch(/secret|authorization|cookie/);
  });
});

describe('GET /api/health', () => {
  it('answers 200 {"ok":true} exactly, never cached, with no credential, when every service is healthy', async () => {
    urls.sql = await serve(200);
    const res = await apiHealth(request('/api/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('answers 503 {"ok":false} and NOTHING more when a service is down, and tells the operator which in the log', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')); });
    urls.sql = await serve(200);
    urls.events = 'http://127.0.0.1:9';
    const res = await apiHealth(request('/api/health'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(logged.join('\n')).toMatch(/\[health\].*events/);
    expect(logged.join('\n')).not.toMatch(/sql/);
  });
  it('logs nothing when everything is fine', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await apiHealth(request('/api/health'));
    expect(error).not.toHaveBeenCalled();
  });
});
