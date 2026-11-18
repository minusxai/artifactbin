/**
 * The identity owner's draft-check seam (lib/page-drafts checkDraft) against the real handler, with the browser's
 * `inspect` stood in: only the owner's anonymous relay reaches it, with exact keys; the draft is made for no reader,
 * shown under its own draft origin from this process and forgotten; a draft the store refuses answers its code; a
 * component refused for consent is no problem; a browser that cannot look is 503.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import { ANONYMOUS, CANONICAL_DRAFT_CHECK_PATH, type Actor, type PageInspectRequest, type PageInspection } from '@artifactbin/contracts';
import { EXPORT_INTERNAL_ORIGIN, services, setServices } from '@/lib/platform';
import { pagesSite } from '@/lib/http';
import { useAppHarness } from '@/__tests__/harness';
import { createAppServer } from '../app';

useAppHarness();
const site = pagesSite();
const app = createAppServer({ indexHtml: async () => '<html></html>', pagesSite: site });
const original = services().browser;
afterEach(() => setServices({ browser: original }));

const b64 = (text: string) => Buffer.from(text).toString('base64');
const PAGE = '<!doctype html><html><head><link rel="af-dataset" data-af-name="monthly" href="./monthly.csv"></head><body>'
  + '<af-chart label="Monthly revenue" sql="select * from monthly"><script type="application/json">{"mark":"bogus"}</script></af-chart></body></html>';
const DRAFT = { html: PAGE, entryPath: 'reports/revenue.html', files: [{ path: 'reports/monthly.csv', base64: b64('month,revenue\n2026-01,10\n') }] };
const seam = (body: unknown, actor: Actor | null = ANONYMOUS) => {
  const req = new Request('http://localhost' + CANONICAL_DRAFT_CHECK_PATH, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
  return app.fetch(actor ? attachActor(req, actor) : req);
};

describe('the identity owner\'s draft-check seam', () => {
  it('shows the draft to the browser under its own origin, from this process, and answers the page\'s problems', async () => {
    const asked: PageInspectRequest[] = [], documents: number[] = [];
    const chart = { kind: 'component' as const, element: 'af-chart', code: 'invalid_chart', label: 'Monthly revenue', message: 'Chart not drawn: the Vega-Lite spec is not valid' };
    setServices({ browser: { ...original, inspect: async (request): Promise<PageInspection> => {
      asked.push(request);
      // The draft is live while it is looked at: its document once, for the ticket, and its files.
      const url = new URL(request.url), host = { headers: { host: url.host } };
      documents.push((await app.request(url.href, host)).status, (await app.request(url.href, host)).status, (await app.request(`${url.origin}/reports/monthly.csv`, host)).status);
      return { ok: true, truncated: false, problems: [chart, { kind: 'component', element: 'af-data-table', code: 'consent_required', message: 'Allow live data' }] };
    } } });
    const answered = await seam(DRAFT);
    expect(answered.status).toBe(200);
    expect(answered.headers.get('cache-control')).toBe('no-store');
    expect(await answered.json()).toEqual({ problems: [chart], truncated: false });
    const [request] = asked as [PageInspectRequest];
    const url = new URL(request.url);
    expect(url.hostname).toMatch(new RegExp(`^draft-[a-z2-7]{26}\\.${site.host.replaceAll('.', '\\.')}$`));
    expect(url.pathname).toBe('/reports/revenue.html');
    expect(url.searchParams.get('_pt')).toEqual(expect.any(String));
    expect(request).toMatchObject({ internalOrigin: EXPORT_INTERNAL_ORIGIN, sameOriginOnly: true, allowedOrigins: [site.app], selector: 'body' });
    expect(documents).toEqual([200, 404, 200]);
    // Forgotten once looked at.
    expect((await app.request(`${url.origin}/reports/monthly.csv`, { headers: { host: url.host } })).status).toBe(404);
  });

  it('answers a refused draft with its code, a browser that cannot look with 503, and only the owner\'s relay with exact keys', async () => {
    let answer: PageInspection = { ok: false, reason: 'failed', detail: 'Render deadline' };
    setServices({ browser: { ...original, inspect: async () => answer } });
    const missing = await seam({ html: '<img src="./gone.png">', files: [] });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'unresolved_draft_files', message: expect.stringContaining('gone.png') });
    expect((await seam(DRAFT)).status).toBe(503);
    answer = { ok: false, reason: 'inspect_unavailable' };
    expect(await (await seam(DRAFT)).json()).toEqual({ error: 'check_unavailable' });
    setServices({ browser: { render: original.render } });
    expect((await seam(DRAFT)).status).toBe(503);
    for (const body of [{ html: PAGE }, { files: [] }, { ...DRAFT, liveSql: true }, { ...DRAFT, title: 'x' }, [DRAFT], 'not json']) expect((await seam(body)).status).toBe(400);
    expect((await seam(DRAFT, null)).status).toBe(403);
    expect((await seam(DRAFT, { credential: 'session', sessionId: 's', userId: 'usr_1', email: 'a@b.c', emailVerified: true })).status).toBe(403);
  });
});
