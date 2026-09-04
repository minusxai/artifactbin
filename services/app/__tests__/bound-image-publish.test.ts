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
import { mintExportKey } from '@/lib/export-key';
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
    // Key-agnostic: milestone 1's review may move asset warnings to their own
    // key; either way, a template must produce none, because nothing was fetched.
    expect([...(body.warnings as unknown[] ?? []), ...(body.asset_warnings as unknown[] ?? [])]).toEqual([]);
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
    expect(html).toContain(`"assetsUrl":"/a/${body.id}/assets"`);
    // The reference itself never reaches the served markup.
    expect(html).not.toContain('src="$pick"');
  });

  /*
   * The SSR STRING, not only the island. The two are rendered from separate
   * prop lists, and a prop that reaches one but not the other is a hydration
   * mismatch — which React 19 answers by discarding the whole server tree.
   * `assetsUrl` is the first island field that CHANGES WHAT IS DRAWN
   * (queryUrl/mutateUrl only name a transport), and it was missing from the SSR
   * call: the served document painted no image at all until hydration.
   */
  it('resolves the bound image IN THE SSR BODY, not only after hydration', async () => {
    const url = `${web}/default.png`;
    const helmet = `<Helmet><Value name="pick" type="string" default="${url}" /></Helmet>`;
    const { body } = await publish(`${helmet}<div><img src="$pick" alt="the pick" /></div>`);
    const page = await rawRoute(request(`/a/${body.id}/raw`), params({ id: body.id as string }));
    const html = await page.text();
    const tag = /<img[^>]*alt="the pick"[^>]*>/.exec(html)?.[0] ?? '';
    expect(tag).toContain(`src="/a/${body.id}/assets?u=${encodeURIComponent(url)}"`);
    expect(tag).not.toContain('data-mx-bound');
    // …and the renderer's own preload hint follows the same mapped address, so
    // the first thing the reader's browser asks for is ours and not the source.
    expect(html).toContain(`rel="preload" as="image" href="/a/${body.id}/assets?u=${encodeURIComponent(url)}"`);
    expect(html).not.toContain(`href="${url}"`);
  });

  it('has a CSP unchanged by this milestone — an <img> load needs no connect-src', async () => {
    const { body } = await publish(`${HELMET}<div><img src="$pick" alt="a" /></div>`);
    const page = await rawRoute(request(`/a/${body.id}/raw`), params({ id: body.id as string }));
    expect(page.headers.get('content-security-policy')).toBe(markupCsp('http://localhost:3000', body.id as string));
    expect(page.headers.get('content-security-policy')).not.toContain('/assets');
  });
});

/**
 * THE CAPTURE. A markup document is photographed from its OWN page
 * (`/a/<id>/raw?chrome=0&key=…`, lib/export) — TOP-LEVEL, with no parent to
 * relay through, and in a headless browser with no session. So the only thing
 * that can carry the exporter's credential to the import endpoint is the
 * address the document is given: without it a private document's og image
 * photographs alt text where its picture should be.
 */
describe('the capture carries the exporter\'s key into its asset endpoint', () => {
  it('puts a VERIFIED key on assetsUrl, and never anything else', async () => {
    const url = `${web}/cap.png`;
    const helmet = `<Helmet><Value name="pick" type="string" default="${url}" /></Helmet>`;
    const { body } = await publish(`${helmet}<div><img src="$pick" alt="the pick" /></div>`);
    const id = body.id as string;
    const key = mintExportKey(id);

    const shot = await rawRoute(request(`/a/${id}/raw?chrome=0&key=${encodeURIComponent(key)}`), params({ id }));
    const html = await shot.text();
    expect(html).toContain(`"assetsUrl":"/a/${id}/assets?key=${key}"`);
    // …and the <img> the exporter loads therefore carries it too.
    expect(/<img[^>]*alt="the pick"[^>]*>/.exec(html)?.[0]).toContain(`/a/${id}/assets?key=${key}&amp;u=`);

    // A reader's ordinary view keeps the bare address — the key is the
    // exporter's, and it must not ride in a document anyone else is served.
    const plain = await rawRoute(request(`/a/${id}/raw`), params({ id }));
    const plainHtml = await plain.text();
    expect(plainHtml).toContain(`"assetsUrl":"/a/${id}/assets"`);
    expect(plainHtml).not.toContain('key=');

    // An INVALID key is admitted nowhere and echoed nowhere.
    const forged = await rawRoute(request(`/a/${id}/raw?chrome=0&key=9999999999.${'a'.repeat(64)}`), params({ id }));
    expect(await forged.text()).toContain(`"assetsUrl":"/a/${id}/assets"`);
  });
});
