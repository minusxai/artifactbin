import {nativeHtml} from './native-html-fixture';
/**
 * THE PUBLISH DOOR AND A BOUND IMAGE SOURCE.
 *
 * A URL written literally is fetched at publish. A source the
 * browser only computes cannot be — so the door's job here is to stop calling
 * a BINDING an external URL, to import nothing it cannot see, and to keep
 * reporting an undeclared name by name. The served document then carries its
 * own asset endpoint, and its CSP is unchanged by any of it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { getArtifactById } from '@/lib/artifacts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { allowLocalWebIngest, restoreWebIngestPolicy } from '@/test/helpers/web-ingest';
import { assetUrlFor } from '@/lib/document/asset-url';
import { getDb } from '@/lib/platform';
import { mintExportKey } from '@/lib/export';

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
  allowLocalWebIngest();
});

afterAll(async () => {
  restoreWebIngestPolicy();
  await server.close();
});

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const publish = async (markup: string) => {
  const t = await mintToken('t');
  const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { html:nativeHtml(markup), visibility: 'public' } }));
  return { res, body: await res.json() as Record<string, unknown> };
};

/** Native scripts own bindings; the platform never evaluates dollar syntax or
 * imports values it cannot see. No retired Value/SSR binding compiler remains. */
describe('native authored image sources',()=>{
 it.each(['$pick','$nope','{$pick}','{$nope}'])('preserves literal %s without fetching or declaring a platform value',async(value)=>{
  hits.length=0;const {res,body}=await publish(`<img src="${value}" alt="the pick">`);expect(res.status).toBe(201);expect(hits).toEqual([]);expect((await getArtifactById(body.id as string))!.source).toContain(`src="${value}"`);
 });
 it('preserves authored dynamic image code and fetches no external bytes during publication',async()=>{
  hits.length=0;const source=`<img id="pick" alt="the pick"><script type="module">document.querySelector('#pick').src=${JSON.stringify(web+'/dynamic.png')}</script><video src="${web}/clip.mp4" controls></video>`;
  const {res,body}=await publish(source);expect(res.status).toBe(201);expect(hits).toEqual([]);expect((await getArtifactById(body.id as string))!.source).toContain('/dynamic.png');expect((await(await getDb()).query('select 1 from web_assets')).rows).toEqual([]);
 });
 it('renders native image source under the sandbox without exposing capture credentials',async()=>{
  const {res,body}=await publish(`<img src="${web}/logo.png" alt="the pick">`);expect(res.status).toBe(201);const id=body.id as string,key=mintExportKey(id);
  for(const suffix of ['',`?chrome=0&key=${key}`,'?chrome=0&key=9999999999.'+'a'.repeat(64)]){
   const page=await rawRoute(request(`/a/${id}/raw${suffix}`),params({id}));expect(page.status).toBe(200);expect(page.headers.get('content-security-policy')).toContain('sandbox');const html=await page.text();expect(html).toContain(`src="${web}/logo.png"`);expect(html).not.toContain(key);expect(html).not.toContain('"assetsUrl"');expect(html).not.toContain(assetUrlFor(`${web}/logo.png`));
  }
 });
});
