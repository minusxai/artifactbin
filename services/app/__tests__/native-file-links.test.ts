import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { samplePdf, samplePdfDataUrl } from '../../../scripts/lib/sample-pdf.mjs';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { getArtifactById } from '@/lib/artifacts';
import {nativeHtml} from './native-html-fixture';
import {DELETE as remove} from '@/app/api/artifacts/[id]/route';
import { getDb } from '@/lib/platform';
import { assetUrlFor } from '@/lib/document/asset-url';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { setWebIngestPolicyForTests } from '@/lib/web-ingest/fetch';
import { request, useAppHarness } from '@/__tests__/harness';
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';

useAppHarness();


let server: RunningServer;
let web: string;
/** Every path the "public web" was asked for: publish must add nothing here. */
const asked: string[] = [];

beforeAll(async () => {
  server = await withHttpServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    asked.push(path);
    switch (path) {
      case '/report.pdf': res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(samplePdf(2)); return;
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

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const create = (token: string, body: Record<string, unknown>) =>
  createArtifact(request('/api/artifacts', { method: 'POST', token, json: body }));

describe('native HTML file links',()=>{
 it('keeps author labels and a normal new-tab file link without component rendering',async()=>{
  const token=await mintToken('native-file');
  const file=await create(token.token,{title:'Q3 results',pdf:samplePdfDataUrl(3),visibility:'public'});
  expect(file.status).toBe(201);const pdf=await file.json();
  const doc=await create(token.token,{html:nativeHtml(`<a href="/a/${pdf.id}/raw" target="_blank" rel="noopener">Download the report</a>`),visibility:'public'});
  expect(doc.status,await doc.clone().text()).toBe(201);const {id}=await doc.json();
  const served=await rawRoute(request(`/a/${id}/raw`),params(id));expect(served.status).toBe(200);
  const html=await served.text();expect(html).toContain('Download the report');expect(html).toContain('target="_blank"');
  expect((await getArtifactById(id))?.source).toContain(`/a/${pdf.id}/raw`);
  const bytes=await rawRoute(request(`/a/${pdf.id}/raw`),params(pdf.id));expect(bytes.status).toBe(200);expect(bytes.headers.get('content-type')).toBe('application/pdf');
  const deleted=await remove(request(`/api/artifacts/${pdf.id}?force=true`,{method:'DELETE',token:token.token}),params(pdf.id));expect(deleted.status).toBe(200);
  expect((await rawRoute(request(`/a/${pdf.id}/raw`),params(pdf.id))).status).toBe(404);
  expect((await rawRoute(request(`/a/${id}/raw`),params(id))).status).toBe(200);
 });
});

describe('a web URL in the same position', () => {
  it('is kept verbatim, fetched by nobody, stored nowhere and served as written', async () => {
    const t = await mintToken('t');
    const url = `${web}/report.pdf`;
    const source = nativeHtml(`<a href="${url}" target="_blank" rel="noopener">The report</a>`);
    asked.length = 0;
    const res = await create(t.token, { html: source, visibility: 'public' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).not.toHaveProperty('asset_warnings');
    expect(asked).toEqual([]);
    const db = await getDb();
    expect((await db.query('select 1 from web_assets where url = $1', [url])).rows).toEqual([]);
    expect((await getArtifactById(body.id))!.source).toContain(url);
    const html = await (await rawRoute(request(`/a/${body.id}/raw`), params(body.id))).text();
    expect(html).toContain(`href="${url}"`);
    expect(html).not.toContain(assetUrlFor(url));
  });

  it('with a % in its filename still SERVES — never a permanent 500', async () => {
    // Native HTML preserves the authored filename without server-side decoding.
    const t = await mintToken('t');
    const url = 'https://example.invalid/50%off.pdf';
    const res = await create(t.token, { html:nativeHtml(`<a href="${url}">50%off.pdf</a>`), visibility: 'public' });
    expect(res.status).toBe(201);
    const { id } = await res.json();

    const served = await rawRoute(request(`/a/${id}/raw`), params(id));
    expect(served.status).toBe(200);
    const html = await served.text();
    // The name is shown as it was written, percent and all.
    expect(html).toContain('50%off.pdf');
  }, 20_000);
});
