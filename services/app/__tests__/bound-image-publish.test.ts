/**
 * THE PUBLISH DOOR AND A BOUND IMAGE SOURCE.
 *
 * A URL written literally is fetched at publish (milestone 1). A source the
 * browser only computes cannot be — so the door's job here is to stop calling
 * a BINDING an external URL, to import nothing it cannot see, and to keep
 * reporting an undeclared name by name. The served document then carries its
 * own asset endpoint, and its CSP is unchanged by any of it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { withHttpServer, type RunningServer } from '@/__tests__/net';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { getArtifactById } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { setWebIngestPolicyForTests } from '@/lib/web-ingest/fetch';
import { assetUrlFor } from '@/lib/story/asset-url';
import { markupCsp } from '@/lib/story/markup-csp';
import { getDb } from '@/lib/db';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);
useAppHarness();

let server: RunningServer;
let web: string;
/** Every path the fake web was asked for — the fetch counter this suite scores on. */
const hits: string[] = [];

beforeAll(async () => {
  server = await withHttpServer((req, res) => {
    hits.push(req.url ?? '');
    if (req.url?.endsWith('.png')) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); return; }
    res.writeHead(404); res.end();
  });
  web = server.base;
  setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
});

afterAll(async () => {
  setWebIngestPolicyForTests(null);
  await server.close();
});

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const publish = async (markup: string) => {
  const t = await mintToken('t');
  const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup } }));
  return { res, body: await res.json() as Record<string, unknown> };
};

const HELMET = '<Helmet><Value name="pick" type="string" default="a" /></Helmet>';

describe('a bound src is a binding, not an external URL', () => {
  it('publishes `<img src="$pick">` — the fall-through that called it an "External URL" is gone', async () => {
    const { res, body } = await publish(`${HELMET}<div><img src="$pick" alt="the pick" /></div>`);
    expect(res.status).toBe(201);
    expect(body.markup_changed).toBe(false);
    expect((await getArtifactById(body.id as string))!.source).toContain('src="$pick"');
  });

  it('publishes the braced form and imports NOTHING — publish cannot complete the URL', async () => {
    hits.length = 0;
    const { res, body } = await publish(`${HELMET}<div><img src="${web}/{$pick}.png" alt="a" /></div>`);
    expect(res.status).toBe(201);
    expect(hits).toEqual([]);
    expect(body.warnings ?? []).toEqual([]);
    expect((await getArtifactById(body.id as string))!.source).toContain('{$pick}');
    const db = await getDb();
    expect((await db.query<{ n: string }>('select count(*)::text as n from web_assets')).rows[0].n).toBe('0');
  });

  it('an UNDECLARED name in src is a named refusal, not an "External URL" one', async () => {
    const { res, body } = await publish(`${HELMET}<div><img src="$nope" alt="a" /></div>`);
    expect(res.status).toBe(400);
    const details = JSON.stringify(body.details ?? body);
    expect(details).toContain('$nope');
    expect(details).not.toContain('External URL');
  });

  it('…and so is an undeclared name inside the braced form', async () => {
    const { res, body } = await publish(`${HELMET}<div><img src="${web}/{$nope}.png" alt="a" /></div>`);
    expect(res.status).toBe(400);
    expect(JSON.stringify(body.details ?? body)).toContain('$nope');
  });

  it('a LITERAL URL is still imported at publish — the two cases live side by side', async () => {
    hits.length = 0;
    const { res, body } = await publish(`${HELMET}<div><img src="${web}/logo.png" /><img src="$pick" /></div>`);
    expect(res.status).toBe(201);
    expect(hits).toEqual(['/logo.png']);
    const page = await rawRoute(request(`/a/${body.id}/raw`), params({ id: body.id as string }));
    expect(await page.text()).toContain(assetUrlFor(`${web}/logo.png`));
  });

  it('a web URL in a NON-image position is still refused as non-self-contained', async () => {
    const { res, body } = await publish(`${HELMET}<div><img src="$pick" /><input value="$pick" /><Video src="https://youtu.be/x" poster="$pick" /></div>`);
    // `poster` is not a bindable position: the ref exemption is `img src` alone.
    expect(res.status).toBe(400);
    expect(JSON.stringify(body.details ?? body)).toContain('External URL');
  });
});

describe('the served document', () => {
  it('carries its own asset endpoint and renders the bound image through it', async () => {
    const { body } = await publish(`${HELMET}<div><img src="$pick" alt="the pick" /></div>`);
    const page = await rawRoute(request(`/a/${body.id}/raw`), params({ id: body.id as string }));
    const html = await page.text();
    expect(html).toContain(`/a/${body.id}/assets`);
    // The reference itself never reaches the served markup.
    expect(html).not.toContain('src="$pick"');
  });

  it('has a CSP unchanged by this milestone — an <img> load needs no connect-src', async () => {
    const { body } = await publish(`${HELMET}<div><img src="$pick" alt="a" /></div>`);
    const page = await rawRoute(request(`/a/${body.id}/raw`), params({ id: body.id as string }));
    expect(page.headers.get('content-security-policy')).toBe(markupCsp('http://localhost:3000', body.id as string));
    expect(page.headers.get('content-security-policy')).not.toContain('/assets');
  });
});
