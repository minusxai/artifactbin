/** The retained download door emits native HTML with the original read policy. */
/* The door itself; what a download packs (images, bundles, DNS provenance, design systems, live cells) is in
 * offline-download-packing.test.ts (split for the CI shards; ./offline-download-fixture.ts). */
import { sha256Hex } from '@artifactbin/utils/sha256';
import { readPortableDocument } from '@/lib/html-runtime/portable';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { useAppHarness, request, mintAccountToken } from '@/__tests__/harness';
import { getArtifactById } from '@/lib/artifacts';
import { GET as download } from '@/app/a/[id]/download/route';
import { params, publish } from './offline-download-fixture';

useAppHarness();

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
    const portable=readPortableDocument(html);
    expect(portable.source).toBe((await getArtifactById(id))!.source);
    expect(portable.identity).toMatchObject({artifactId:id,baseRevision:'1',sourceDigest:sha256Hex(portable.source)});
    expect(new URL(portable.identity!.platformOrigin).origin).toBe(portable.identity!.platformOrigin);
    expect(doc.querySelector('script[src="/af/core.js"]')).toBeNull();
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
