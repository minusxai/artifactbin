/**
 * WHERE THE APP GETS ITS SERVICES. One registry, filled ONCE at composition:
 * a URL in config means an HTTP client; a local implementation is whatever
 * the composition root registered; neither means a noop that says so. The
 * app tree itself never decides — and never imports — where DuckDB or
 * Chromium run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isQueryFailure } from '@artifactbin/contracts';
import { fakeSql } from '@artifactbin/utils';

const load = async () => { vi.resetModules(); return import('@/lib/services'); };
const RUN = { tables: {}, queries: [{ name: 'q', sql: 'select 1' }], params: {} };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('services()', () => {
  it('is an HTTP client when SQL__SERVICE_URL is set', async () => {
    vi.stubEnv('SQL__SERVICE_URL', 'http://sql.internal:8080');
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { sent.push(String(url)); return new Response(JSON.stringify({ results: { q: { rows: [], columns: [] } } })); });
    const { services } = await load();
    await services().sql.run(RUN);
    expect(sent).toEqual(['http://sql.internal:8080/run']);
  });
  /**
   * THE BROWSER SEAM, WHICH REPLACED THE WEBSOCKET ONE. `BROWSER__WS_URL` used
   * to pick `chromium.connect()` over `chromium.launch()` — a choice that
   * could not remove Playwright from the image, because the connect client IS
   * Playwright. It is an HTTP service now, so the app holds a client that
   * imports nothing. (This case is what `lib/__tests__/export-browser.test.ts`
   * guarded before the seam changed shape.)
   */
  it('is an HTTP client to the browser service when BROWSER__SERVICE_URL is set', async () => {
    vi.stubEnv('BROWSER__SERVICE_URL', 'http://browser.internal:8080');
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      sent.push(String(url));
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { 'content-type': 'image/png' } });
    });
    const { services } = await load();
    const r = await services().browser.render({ url: 'http://app/a/x/raw', format: 'png', viewport: { width: 1, height: 1 }, selector: 'body', capture: 'full' });
    expect(sent).toEqual(['http://browser.internal:8080/render']);
    // The BYTES come back, not a JSON envelope around them: an image is the
    // answer's body and the verdicts are the exception.
    expect(r).toEqual({ ok: true, mime: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
  });

  it('is what the composition root registered, otherwise', async () => {
    vi.stubEnv('SQL__SERVICE_URL', '');
    const { services, setServices } = await load();
    const sql = fakeSql({ q: { rows: [{ one: 1 }], columns: [{ name: 'one', type: 'number' }] } });
    setServices({ sql });
    expect((await services().sql.run(RUN)).q).toEqual({ rows: [{ one: 1 }], columns: [{ name: 'one', type: 'number' }] });
  });
  it('survives a module reload — registration lives with the process, like the browser singleton', async () => {
    vi.stubEnv('SQL__SERVICE_URL', '');
    const first = await load();
    first.setServices({ sql: fakeSql({ q: { rows: [{ kept: true }], columns: [] } }) });
    const second = await load();
    expect((await second.services().sql.run(RUN)).q).toEqual({ rows: [{ kept: true }], columns: [] });
  });
  it('is an explicit noop when nothing is configured or registered', async () => {
    vi.stubEnv('SQL__SERVICE_URL', ''); vi.stubEnv('BROWSER__SERVICE_URL', '');
    const { services, setServices } = await load();
    setServices({ sql: undefined, browser: undefined });
    const r = await services().sql.run(RUN);
    expect(isQueryFailure(r.q) && r.q.error).toBe('service_unavailable');
    expect(await services().browser.render({ url: 'http://x', format: 'png', viewport: { width: 1, height: 1 }, selector: 'body', capture: 'full' })).toEqual({ ok: false, reason: 'unavailable' });
  });
});
