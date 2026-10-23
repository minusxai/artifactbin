/** The retained download door emits native HTML with the original read policy. */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { useAppHarness, request, mintAccountToken } from '@/__tests__/harness';
import { POST } from '@/app/api/artifacts/route';
import { GET as download } from '@/app/a/[id]/download/route';
useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const source = '<!doctype html><html><head><title>Trip plan</title><style>.status{color:rgb(20,90,40)}</style><script type="application/json" data-af="state">{"count":3,"label":"&lt;route&gt;"}</script><script src="/af/v1/core.js"></script><script type="module">import {client,gql} from "@afbin/apollo";</script></head><body><h1 class="status">Trip plan</h1><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg><img alt="Portable pixel" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></body></html>';
async function publish(visibility: 'private' | 'unlisted') {
  const actor = await mintAccountToken(`native-download-${visibility}`);
  const response = await POST(request('/api/artifacts', { method: 'POST', token: actor.token, json: { html: source, visibility } }));
  expect(response.status, await response.clone().text()).toBe(201);
  return { actor, id: (await response.json()).id as string };
}
describe('GET /a/<id>/download', () => {
  it('gives an authorized reader one native HTML attachment without account credentials', async () => {
    const { actor, id } = await publish('private');
    const response = await download(request(`/a/${id}/download`, { token: actor.token }), params(id));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="Trip plan.html"; filename*=UTF-8\'\'Trip%20plan.html');
    const html = await response.text();
    expect(html).not.toContain(actor.token);
    expect(html).not.toContain('afbin-file');
    expect(html).not.toContain('afbin-compiled-code');
    const doc = new JSDOM(html).window.document;
    const runtime = JSON.parse(doc.querySelector('[data-af="runtime"]')!.textContent!);
    expect(runtime).toMatchObject({ pageId: id, revision: '1', offline: true, initialState: { count: 3 } });
    expect(runtime.appOrigin).toBeUndefined();
    expect(doc.querySelectorAll('script[data-af="core"]')).toHaveLength(1);
    expect(doc.querySelector('script[src="/af/v1/core.js"]')).toBeNull();
  });
  it('lets anyone with an unlisted link download the native document', async () => {
    const { id } = await publish('unlisted');
    expect((await download(request(`/a/${id}/download`), params(id))).status).toBe(200);
  });
  it('keeps private and missing documents behind the same read refusal', async () => {
    const { id } = await publish('private');
    const stranger = await mintAccountToken('native-download-stranger');
    expect((await download(request(`/a/${id}/download`), params(id))).status).toBe(404);
    expect((await download(request(`/a/${id}/download`, { token: stranger.token }), params(id))).status).toBe(404);
    expect((await download(request('/a/Zz99Zz/download'), params('Zz99Zz'))).status).toBe(404);
  });
  it('preserves portable authored styles, media and viewer defaults as ordinary HTML', async () => {
    const { actor, id } = await publish('private');
    const response = await download(request(`/a/${id}/download`, { token: actor.token }), params(id));
    const doc = new JSDOM(await response.text()).window.document;
    expect(doc.querySelector('style')!.textContent).toContain('.status{color:rgb(20,90,40)}');
    expect(doc.querySelector('h1')!.getAttribute('class')).toBe('status');
    expect(doc.querySelector('svg circle')!.getAttribute('r')).toBe('4');
    expect(doc.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/gif;base64,/);
    expect(doc.querySelector('[data-af="state"]')!.textContent).toContain('"count":3');
  });
});
