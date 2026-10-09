import {documentPublicationWithResources} from './prepared-document';
import {prepareDocumentAuthoringContext} from '@/lib/publish/publish';
import {prepareClientDocumentPublication} from '@/lib/document/document-update-client';
import {observedRequest} from '@/__tests__/conditional-request';
/**
 * Importing assets FROM THE WEB, through the real doors: ingest-and-own.
 *
 * Two doors fetch a URL once and own a copy:
 *
 *   1. `imageUrl` on create — an image artifact straight from a URL,
 *   2. `csvUrl` on create — a dataset from any public CSV, not only Sheets.
 *
 * A URL written INTO markup (`<img src="https://…">`, an `@font-face` url) is
 * not one of them: the document is its own page under a CSP that admits
 * `img-src https:`, so publish fetches nothing and the reader loads the URL as
 * written.
 *
 * All of it under lib/web-ingest's guard, whose refusals must surface as
 * actionable 400s naming the URL — an agent can fix "404" and cannot fix
 * silence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as getArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { GET as listArtifacts, POST as createArtifact } from '@/app/api/artifacts/route';
import { POST as editsRoute } from '@/app/api/artifacts/[id]/edits/route';
import { getArtifactById } from '@/lib/artifacts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { setWebIngestPolicyForTests } from '@/lib/web-ingest/fetch';
import { assetUrlFor } from '@/lib/document/asset-url';
import { getDb } from '@/lib/platform';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const CSV = 'region,units\nnorth,42\nsouth,17\n';
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(64, 3)]);
useAppHarness();

let server: RunningServer;
let web: string; // the "public web" this suite serves
/** Every path the "public web" was asked for: a document naming a URL must add nothing here. */
const hits: string[] = [];

beforeAll(async () => {
  server = await withHttpServer((req, res) => {
    hits.push((req.url ?? '').split('?')[0]!);
    // The path alone decides: tests distinguish URLs by a query string (the
    // cache is keyed by the whole URL), and every one of them wants these bytes.
    switch ((req.url ?? '').split('?')[0]) {
      case '/logo.png': res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); return;
      case '/photo.jpg': res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(JPG); return;
      case '/rows.csv': res.writeHead(200, { 'Content-Type': 'text/csv' }); res.end(CSV); return;
      case '/rows-as-octet-stream.csv': res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(CSV); return;
      case '/gone.png': res.writeHead(404); res.end(); return;
      case '/page.html': res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>not an image</html>'); return;
      case '/face.woff2': res.writeHead(200, { 'Content-Type': 'font/woff2' }); res.end(WOFF2); return;
      case '/gone.woff2': res.writeHead(404); res.end(); return;
      default: res.writeHead(500); res.end();
    }
  });
  web = server.base;
  setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
});

afterAll(async () => {
  setWebIngestPolicyForTests(null);
  await server.close();
});

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

describe('imageUrl — an image artifact straight from a URL', () => {
  it('creates the artifact from the fetched bytes; /raw serves them; provenance rides meta', async () => {
    const t = await mintToken('t');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public', imageUrl: `${web}/logo.png`, title: 'logo' } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.format).toBe('image');
    // The full read-back carries the sniffed type (the create echo is the slim shape).
    const read = await getArtifactRoute(request(`/api/artifacts/${body.id}`, { token: t.token }), params({ id: body.id }));
    expect((await read.json()).contentType).toBe('image/png');

    const raw = await rawRoute(request(`/a/${body.id}/raw`), params({ id: body.id }));
    expect(raw.status).toBe(200);
    expect(Buffer.from(await raw.arrayBuffer()).equals(PNG)).toBe(true);

    const row = (await getArtifactById(body.id))!;
    expect((row.meta as { sourceUrl?: string }).sourceUrl).toBe(`${web}/logo.png`);
  });

  it('answers a dead URL with a 400 that names it', async () => {
    const t = await mintToken('t');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public', imageUrl: `${web}/gone.png` } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('image_fetch_failed');
    expect(String(body.details)).toContain('/gone.png');
  });

  it('stays ONE content input: imageUrl beside markup is the usual 400', async () => {
    const t = await mintToken('t');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public', imageUrl: `${web}/logo.png`, markup: '<p>x</p>' } }));
    expect(res.status).toBe(400);
  });
});

describe('the agent door — an external <img src> is served as written and never copied', () => {
  /** What the document's own page loads: the URL the author wrote, and nothing of ours. */
  const servedHtml = async (id: string) => (await rawRoute(request(`/a/${id}/raw`), params({ id }))).text();
  const storedAssets = async () =>
    Number((await (await getDb()).query<{ n: string }>('select count(*)::text as n from web_assets')).rows[0]!.n);

  it('stores no asset row, fetches nothing and serves the original URL', async () => {
    const t = await mintToken('t');
    hits.length = 0;
    const markup = `<div className="p-8" id="root"><h1 id="heading">Doc</h1><img id="logo" src="${web}/logo.png" alt="logo" /></div>`;
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public', markup } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.markup_changed).toBe(false);
    expect(body).not.toHaveProperty('asset_warnings');
    expect((await getArtifactById(body.id))!.source).toContain(`${web}/logo.png`);
    expect(hits).toEqual([]);
    expect(await storedAssets()).toBe(0);
    // No image artifact was invented on its behalf either.
    const list = await listArtifacts(request('/api/artifacts', { token: t.token }));
    expect((await list.json()).artifacts).toHaveLength(1);

    const html = await servedHtml(body.id);
    expect(html).toContain(`src="${web}/logo.png"`);
    expect(html).not.toContain(assetUrlFor(`${web}/logo.png`));
    expect(html).not.toContain('/assets/');
  });

  it('publishes a URL on a host that does not resolve, with no warning and nothing stored', async () => {
    const t = await mintToken('t');
    const url = 'https://nowhere.invalid/x.png';
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public',
      markup: `<div><img src="${url}" alt="missing" /></div>`,
    } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).not.toHaveProperty('asset_warnings');
    expect(body.warnings).toBeUndefined();
    expect(await storedAssets()).toBe(0);
    expect(await servedHtml(body.id)).toContain(`src="${url}"`);
  });

  it('has no cap on how many web images one document names', async () => {
    const t = await mintToken('t');
    hits.length = 0;
    const many = Array.from({ length: 20 }, (_, i) => `<img src="${web}/logo.png?n=${i}" alt="" />`).join('');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public', markup: `<div>${many}</div>` } }));
    expect(res.status).toBe(201);
    expect(hits).toEqual([]);
    expect(await storedAssets()).toBe(0);
  });

  it('PUT serves the URL as written too — the shared pipeline, not just create', async () => {
    const t = await mintToken('t');
    const made = await (await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public', markup: '<p>v1</p>' } }))).json();
    hits.length = 0;
    const put = await putArtifact(await observedRequest(`/api/artifacts/${made.id}`, { method: 'PUT', token: t.token, json: {
      markup: `<div><img src="${web}/photo.jpg" alt="" /></div>`,
    } }), params({ id: made.id }));
    expect(put.status).toBe(200);
    expect(await put.json()).not.toHaveProperty('asset_warnings');
    expect(hits).toEqual([]);
    expect(await storedAssets()).toBe(0);
    expect(await servedHtml(made.id)).toContain(`src="${web}/photo.jpg"`);
  });

  it('the EDITS door asks for no authoring context and imports nothing for a pasted web image', async () => {
    const t = await mintToken('t');
    const made = await (await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public', markup: '<div id="root"><p id="body">hello</p></div>' } }))).json();
    const row=(await getArtifactById(made.id))!;
    if(row.document?.kind!=='graph')throw new Error('Missing authoring graph');
    hits.length = 0;
    let asked=0;
    const update=await prepareClientDocumentPublication({...row,document:row.document},{source:row.source!.replace('</div>',`<img id="logo" src="${web}/logo.png" alt="" /></div>`)},async source=>{
      asked++;
      return (await prepareDocumentAuthoringContext({tokenId:t.id,userId:t.userId},made.id,{source})).json();
    });
    const res=await editsRoute(request(`/api/artifacts/${made.id}/edits`,{method:'POST',token:t.token,json:{edit_id:row.edit_id,document_update:update}}),params({id:made.id}));
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty('asset_warnings');
    expect(asked).toBe(0);
    expect(hits).toEqual([]);
    expect(await storedAssets()).toBe(0);
    expect((await getArtifactById(made.id))!.source).toContain(`${web}/logo.png`);
    expect(await servedHtml(made.id)).toContain(`src="${web}/logo.png"`);
  });

  it('the EDITS door through the prepared-resources helper stores nothing either', async () => {
    const t = await mintToken('t');
    const made = await (await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public', markup: '<div id="root"><p id="body">hello</p></div>' } }))).json();
    const row=(await getArtifactById(made.id))!;
    hits.length = 0;
    const body=await documentPublicationWithResources(row,{source:row.source!.replace('</div>',`<img id="logo" src="${web}/logo.png" alt="" /></div>`)});
    const res=await editsRoute(request(`/api/artifacts/${made.id}/edits`,{method:'POST',token:t.token,json:body}),params({id:made.id}));
    expect(res.status).toBe(200);
    expect(hits).toEqual([]);
    expect(await storedAssets()).toBe(0);
  });
});

describe('an @font-face url in the document stylesheet', () => {
  it('is kept in the source and served as written, with nothing fetched or stored', async () => {
    const t = await mintToken('t');
    hits.length = 0;
    const css = `@font-face{font-family:Mine;src:url(${web}/face.woff2) format('woff2')}`;
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public',
      markup: `<Helmet><style>{\`${css}\`}</style></Helmet><p className="font-[Mine]">words</p>`,
    } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).not.toHaveProperty('asset_warnings');
    expect((await getArtifactById(body.id))!.source).toContain(`${web}/face.woff2`);
    expect(hits).toEqual([]);
    expect(Number((await (await getDb()).query<{ n: string }>('select count(*)::text as n from web_assets')).rows[0]!.n)).toBe(0);
    const html = await (await rawRoute(request(`/a/${body.id}/raw`), params({ id: body.id }))).text();
    expect(html).toContain(`${web}/face.woff2`);
    expect(html).not.toContain(assetUrlFor(`${web}/face.woff2`));
  });
});

describe('csvUrl — a dataset from any public CSV', () => {
  it('creates a typed dataset from the fetched text', async () => {
    const t = await mintToken('t');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public', csvUrl: `${web}/rows.csv`, title: 'sales' } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.format).toBe('dataset');
    expect(body.rowCount).toBe(2);
    expect(body.columns).toEqual([
      { name: 'region', type: 'string' },
      { name: 'units', type: 'number' },
    ]);
  });

  it('accepts a CSV served as octet-stream — the TEXT decides, not the header', async () => {
    const t = await mintToken('t');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public', csvUrl: `${web}/rows-as-octet-stream.csv` } }));
    expect(res.status).toBe(201);
    expect((await res.json()).rowCount).toBe(2);
  });

  it('refuses a dead URL with a 400 naming it', async () => {
    const t = await mintToken('t');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public', csvUrl: `${web}/gone.png` } }));
    expect(res.status).toBe(400);
    expect(String(JSON.stringify(await res.json()))).toContain('/gone.png');
  });
});
