/**
 * Importing assets FROM THE WEB, through the real doors: ingest-and-own.
 *
 * A URL is a SOURCE, never a reference — the server fetches it once at publish
 * time and the artifact owns a copy, so the served document stays fully
 * self-contained (no CSP change, no reader-IP leak, no rot). Three doors:
 *
 *   1. `imageUrl` on create — an image artifact straight from a URL,
 *   2. `<img src="https://…">` (and `<Video poster>`, and an `@font-face`
 *      `src` url) in markup — the agent door: imported into the global URL
 *      cache while the URL STAYS in the stored document, and mapped to our
 *      copy on the way out (lib/web-assets, lib/story/asset-url),
 *   3. `csvUrl` on create — a dataset from any public CSV, not only Sheets.
 *
 * All of it under lib/web-ingest's guard, whose refusals must surface as
 * actionable 400s naming the URL — an agent can fix "404" and cannot fix
 * silence.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { withHttpServer, type RunningServer } from '@/__tests__/net';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as getArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { GET as listArtifacts, POST as createArtifact } from '@/app/api/artifacts/route';
import { POST as editsRoute } from '@/app/api/artifacts/[id]/edits/route';
import { getArtifactById } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { setWebIngestPolicyForTests } from '@/lib/web-ingest/fetch';
import { assetUrlFor } from '@/lib/story/asset-url';
import { getDb } from '@/lib/db';

const BASE = 'http://localhost:3000';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const CSV = 'region,units\nnorth,42\nsouth,17\n';
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(64, 3)]);
useAppHarness();

let server: RunningServer;
let web: string; // the "public web" this suite serves

beforeAll(async () => {
  server = await withHttpServer((req, res) => {
    switch (req.url) {
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
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { imageUrl: `${web}/logo.png`, title: 'logo' } }));
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
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { imageUrl: `${web}/gone.png` } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('image_fetch_failed');
    expect(String(body.details)).toContain('/gone.png');
  });

  it('stays ONE content input: imageUrl beside markup is the usual 400', async () => {
    const t = await mintToken('t');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { imageUrl: `${web}/logo.png`, markup: '<p>x</p>' } }));
    expect(res.status).toBe(400);
  });
});

describe('the agent door — external <img src> is imported and the URL is KEPT', () => {
  it('stores the URL verbatim and serves our copy', async () => {
    const t = await mintToken('t');
    const markup = `<div className="p-8"><h1>Doc</h1><img src="${web}/logo.png" alt="logo" /></div>`;
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    // NOTHING was rewritten, so the echo is not news: the agent reads back the
    // document it sent, and the URL it wrote is still the URL it wrote.
    expect(body.markup_changed).toBe(false);
    expect((await getArtifactById(body.id))!.source).toContain(`${web}/logo.png`);
    // …and no image artifact was invented on its behalf.
    const list = await listArtifacts(request('/api/artifacts', { token: t.token }));
    expect((await list.json()).artifacts).toHaveLength(1);

    // The SERVED document points at our copy and never at the source host.
    const page = await rawRoute(request(`/a/${body.id}/raw`), params({ id: body.id }));
    const html = await page.text();
    expect(html).toContain(assetUrlFor(`${web}/logo.png`));
    expect(html).not.toContain('127.0.0.1');
  });

  it('one URL is one stored object, however many times a document names it', async () => {
    const t = await mintToken('t');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: {
      markup: `<div><img src="${web}/logo.png" /><img src="${web}/logo.png" /></div>`,
    } }));
    expect(res.status).toBe(201);
    const db = await getDb();
    expect((await db.query<{ n: string }>('select count(*)::text as n from web_assets')).rows[0].n).toBe('1');
  });

  it('a dead URL is a WARNING, not a refusal — the document publishes', async () => {
    const t = await mintToken('t');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: {
      markup: `<div><img src="${web}/logo.png" /><img src="${web}/gone.png" alt="missing" /></div>`,
    } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.warnings).toEqual([expect.objectContaining({ code: 'bad_status', url: `${web}/gone.png` })]);
    expect(String(body.warnings[0].fix).length).toBeGreaterThan(0);
    // The good one still maps; the dead one keeps its URL, and the browser
    // draws the alt text (the document's CSP never reaches the host for it).
    const html = await (await rawRoute(request(`/a/${body.id}/raw`), params({ id: body.id }))).text();
    expect(html).toContain(assetUrlFor(`${web}/logo.png`));
    expect(html).toContain('missing');
  });

  it('an image URL serving html is warned about by the sniff, and stores nothing', async () => {
    const t = await mintToken('t');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: {
      markup: `<div><img src="${web}/page.html" /></div>`,
    } }));
    expect(res.status).toBe(201);
    expect((await res.json()).warnings[0].code).toBe('unsupported_type');
    const db = await getDb();
    expect((await db.query<{ n: string }>('select count(*)::text as n from web_assets')).rows[0].n).toBe('0');
  });

  it('caps the imports one publish may make', async () => {
    const t = await mintToken('t');
    const many = Array.from({ length: 9 }, (_, i) => `<img src="${web}/logo.png?n=${i}" />`).join('');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: `<div>${many}</div>` } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('too_many_external_images');
  });

  it('a <Video poster> follows the same rule', async () => {
    const t = await mintToken('t');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: {
      markup: `<div><Video src="https://youtu.be/dQw4w9WgXcQ" poster="${web}/photo.jpg" /></div>`,
    } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect((await getArtifactById(body.id))!.source).toContain(`${web}/photo.jpg`);
    const html = await (await rawRoute(request(`/a/${body.id}/raw`), params({ id: body.id }))).text();
    expect(html).toContain(assetUrlFor(`${web}/photo.jpg`));
  });

  it('PUT imports too — the shared pipeline, not just create', async () => {
    const t = await mintToken('t');
    const made = await (await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<p>v1</p>' } }))).json();
    const put = await putArtifact(request(`/api/artifacts/${made.id}`, { method: 'PUT', token: t.token, json: {
      markup: `<div><img src="${web}/photo.jpg" /></div>`,
    } }), params({ id: made.id }));
    expect(put.status).toBe(200);
    const html = await (await rawRoute(request(`/a/${made.id}/raw`), params({ id: made.id }))).text();
    expect(html).toContain(assetUrlFor(`${web}/photo.jpg`));
  });

  it('the EDITS door imports too — an agent pasting a web image mid-edit', async () => {
    const t = await mintToken('t');
    const made = await (await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<div><p>hello</p></div>' } }))).json();
    const res = await editsRoute(request(`/api/artifacts/${made.id}/edits`, { method: 'POST', token: t.token, json: {
      edit_id: made.edit_id,
      old_string: '<p>hello</p>',
      new_string: `<p>hello</p><img src="${web}/logo.png" />`,
    } }), params({ id: made.id }));
    expect(res.status).toBe(200);
    const html = await (await rawRoute(request(`/a/${made.id}/raw`), params({ id: made.id }))).text();
    expect(html).toContain(assetUrlFor(`${web}/logo.png`));
  });
});

describe('a self-hosted font', () => {
  it('is imported at publish, kept in the source, and served from our origin', async () => {
    const t = await mintToken('t');
    const css = `@font-face{font-family:Mine;src:url(${web}/face.woff2) format('woff2')}`;
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: {
      markup: `<Helmet><style>{\`${css}\`}</style></Helmet><p className="font-[Mine]">words</p>`,
    } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    // R7: this used to publish 201 with the @font-face silently deleted.
    expect((await getArtifactById(body.id))!.source).toContain(`${web}/face.woff2`);
    const html = await (await rawRoute(request(`/a/${body.id}/raw`), params({ id: body.id }))).text();
    expect(html).toContain(assetUrlFor(`${web}/face.woff2`));
    expect(html).not.toContain(`${web}/face.woff2`);
  });

  it('a face that will not load is a warning, and the rest of the document publishes', async () => {
    const t = await mintToken('t');
    const css = `@font-face{font-family:Mine;src:url(${web}/gone.woff2) format('woff2')}`;
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: {
      markup: `<Helmet><style>{\`${css}\`}</style></Helmet><p>words</p>`,
    } }));
    expect(res.status).toBe(201);
    expect((await res.json()).warnings[0].url).toBe(`${web}/gone.woff2`);
  });
});

describe('csvUrl — a dataset from any public CSV', () => {
  it('creates a typed dataset from the fetched text', async () => {
    const t = await mintToken('t');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { csvUrl: `${web}/rows.csv`, title: 'sales' } }));
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
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { csvUrl: `${web}/rows-as-octet-stream.csv` } }));
    expect(res.status).toBe(201);
    expect((await res.json()).rowCount).toBe(2);
  });

  it('refuses a dead URL with a 400 naming it', async () => {
    const t = await mintToken('t');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { csvUrl: `${web}/gone.png` } }));
    expect(res.status).toBe(400);
    expect(String(JSON.stringify(await res.json()))).toContain('/gone.png');
  });
});
