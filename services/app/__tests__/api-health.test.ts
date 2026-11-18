/**
 * GET /api/health — readiness for the WHOLE stack, blind on the wire.
 *
 * `/health` on every process is that process's own liveness; nothing said
 * whether a user could be served. This URL does: under `/api/` the proxy has
 * already forwarded and the app has already answered, and the handler adds
 * the hop the app owns — sql, browser and events on their own `/health`.
 * The body is `{ok}` and nothing else: which service failed is the
 * operator's business (one log line), not the public's (topology).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from '@/__tests__/harness';
import { overrideConfig, resetConfigOverrides } from '@/lib/platform/config';
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';
import { GET as apiHealth } from '@/app/api/health/route';
import { stackHealth } from '@/lib/runtime';
import { QUERY_TIMEOUT_MS } from '@/lib/platform';
import { SERVICE_AUTH_HEADER, SQL_ROUTES } from '@artifactbin/contracts';


const servers: RunningServer[] = [];
const seen: Array<{path:string|undefined;method:string|undefined;headers:Record<string, string | string[] | undefined>}> = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  seen.length = 0;
  resetConfigOverrides();
  vi.restoreAllMocks();
});

/**
 * A throwaway service whose `/health` answers `status` after `delayMs`. The
 * socket belongs to `@artifactbin/test-support/net` (process-socket rule 1): a slow leg here
 * is abandoned mid-flight by the probe's deadline, and only that fixture's
 * close tears the live connection down instead of waiting on it.
 */
async function serve(status: number, delayMs = 0, policy:unknown={version:1,queryTimeoutMs:QUERY_TIMEOUT_MS}): Promise<string> {
  const running = await withHttpServer((req, res) => {
    seen.push({path:req.url,method:req.method,headers:req.headers});
    setTimeout(() => {
      const policyRequest=req.url===SQL_ROUTES.readPolicy&&req.method==='POST'&&policy!==null;
      res.statusCode=req.url==='/health'||policyRequest?status:404;
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify(policyRequest?policy:{ok:true}));
    }, delayMs);
  });
  servers.push(running);
  return running.base;
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
    // The probe deadline is the test's to end: all three probes are in flight together before it does, so they run in
    // parallel; when it ends, every unanswered one is down.
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const silent = await serve(200, 60_000);
    const health = stackHealth({ sql: silent, browser: silent, events: silent });
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    deadline.abort();
    expect(await health).toEqual({ ok: false, failing: ['sql', 'browser', 'events'] });
  });
  it('keeps liveness credential-free and authenticates only the private SQL policy probe', async () => {
    const good = await serve(200);
    overrideConfig({internalServiceSecret:'synthetic_health_probe'});
    await stackHealth({ sql: good, browser: null, events: null });
    expect(seen.map(({path,method})=>[method,path])).toEqual([['GET','/health'],['POST',SQL_ROUTES.readPolicy]]);
    for (const name of Object.keys(seen[0]!.headers)) expect(name.toLowerCase()).not.toMatch(/secret|authorization|cookie/);
    expect(seen[1]!.headers[SERVICE_AUTH_HEADER]).toBe('synthetic_health_probe');
  });
  it.each([null,{version:1,queryTimeoutMs:QUERY_TIMEOUT_MS+1}])('refuses a healthy SQL process without the matching engine policy',async policy=>{
    const good=await serve(200,0,policy);
    expect(await stackHealth({sql:good,browser:null,events:null})).toEqual({ok:false,failing:['sql']});
  });
});

describe('stackHealth database probe', () => {
  const none = { sql: null, browser: null, events: null };
  it('the default probe runs SELECT 1 on the serving database and is healthy', async () => {
    expect(await stackHealth(none)).toEqual({ ok: true, failing: [] });
  });
  it('a failing database reads as degraded, named db, after the services', async () => {
    const bad = await serve(500);
    expect(await stackHealth({ ...none, events: bad }, async () => false)).toEqual({ ok: false, failing: ['events', 'db'] });
    expect(await stackHealth(none, async () => { throw new Error('connection refused'); })).toEqual({ ok: false, failing: ['db'] });
  });
});

describe('GET /api/health', () => {
  it('answers 200 {"ok":true} exactly, never cached, with no credential, when every service is healthy', async () => {
    overrideConfig({ sqlServiceUrl: await serve(200) });
    const res = await apiHealth(request('/api/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('answers 503 {"ok":false} and NOTHING more when a service is down, and tells the operator which in the log', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')); });
    overrideConfig({ sqlServiceUrl: await serve(200) });
    overrideConfig({ eventsServiceUrl: 'http://127.0.0.1:9' });
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
