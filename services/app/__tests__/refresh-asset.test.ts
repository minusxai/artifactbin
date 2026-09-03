/**
 * refresh_asset — the answer to "the source image changed" (R13).
 *
 * The URL cache is GLOBAL and first-cached wins, which is the right trade for
 * bytes that almost never change and the wrong one the day they do. This is the
 * door out: by URL, or by DOCUMENT (every external URL it names), answering
 * what moved, what did not, and what failed and why.
 *
 * Reach is the read ACL for the document form, so the miss is the uniform 404;
 * the URL form refreshes what we already hold, because refreshing is about the
 * copy we serve, and importing is what publishing a document does.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { withHttpServer, type RunningServer } from '@/__tests__/net';
import { POST as refreshRoute } from '@/app/api/artifacts/assets/refresh/route';
import { POST as myRefreshRoute } from '@/app/api/my/artifacts/[id]/assets/refresh/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { setWebIngestPolicyForTests } from '@/lib/web-ingest/fetch';
import { mintToken } from '@/lib/tokens';
import { webAssetByHash } from '@/lib/web-assets';
import { urlHash } from '@/lib/story/asset-url';
import { agentCookie } from '@/__tests__/harness';

useAppHarness();

let server: RunningServer;
let web: string;
let colour = 0x11;

beforeAll(async () => {
  server = await withHttpServer((req, res) => {
    if (req.url === '/photo.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      // A PNG the optimiser will not decode: passed through untouched, so the
      // stored bytes ARE these and "changed" is unambiguous.
      res.end(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8, colour)]));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  web = server.base;
  setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
});

afterAll(async () => {
  setWebIngestPolicyForTests(null);
  await server.close();
});

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const publishWithImage = async (token: string) => {
  const res = await createArtifact(request('/api/artifacts', { method: 'POST', token, json: {
    markup: `<div><img src="${web}/photo.png" alt="p" /></div>`,
  } }));
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
};

describe('POST /api/artifacts/assets/refresh', () => {
  it('re-fetches one URL and repoints the row', async () => {
    const t = await mintToken('t');
    colour = 0x11;
    await publishWithImage(t.token);
    const before = (await webAssetByHash(urlHash(`${web}/photo.png`)))!.object_key;

    colour = 0x22;
    const res = await refreshRoute(request('/api/artifacts/assets/refresh', { method: 'POST', token: t.token, json: { url: `${web}/photo.png` } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.refreshed).toEqual([`${web}/photo.png`]);
    expect(body.failed).toEqual([]);
    expect((await webAssetByHash(urlHash(`${web}/photo.png`)))!.object_key).not.toBe(before);
  });

  it('says UNCHANGED when the source is the same bytes', async () => {
    const t = await mintToken('t');
    colour = 0x33;
    await publishWithImage(t.token);
    const res = await refreshRoute(request('/api/artifacts/assets/refresh', { method: 'POST', token: t.token, json: { url: `${web}/photo.png` } }));
    const body = await res.json();
    expect(body.unchanged).toEqual([`${web}/photo.png`]);
    expect(body.refreshed).toEqual([]);
  });

  it('names a URL we do not hold, rather than importing it', async () => {
    const t = await mintToken('t');
    const res = await refreshRoute(request('/api/artifacts/assets/refresh', { method: 'POST', token: t.token, json: { url: `${web}/never.png` } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.failed).toEqual([expect.objectContaining({ url: `${web}/never.png`, code: 'not_cached' })]);
    expect(await webAssetByHash(urlHash(`${web}/never.png`))).toBeNull();
  });

  it('refreshes every URL a DOCUMENT names', async () => {
    const t = await mintToken('t');
    colour = 0x44;
    const made = await publishWithImage(t.token);
    const before = (await webAssetByHash(urlHash(`${web}/photo.png`)))!.object_key;

    colour = 0x55;
    const res = await refreshRoute(request('/api/artifacts/assets/refresh', { method: 'POST', token: t.token, json: { id: made.id } }));
    expect((await res.json()).refreshed).toEqual([`${web}/photo.png`]);
    expect((await webAssetByHash(urlHash(`${web}/photo.png`)))!.object_key).not.toBe(before);
  });

  it('answers the uniform 404 for a document this token cannot reach', async () => {
    const owner = await mintToken('owner');
    const stranger = await mintToken('stranger');
    const made = await publishWithImage(owner.token);
    const res = await refreshRoute(request('/api/artifacts/assets/refresh', { method: 'POST', token: stranger.token, json: { id: made.id } }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
  });

  it('refuses a call that names neither', async () => {
    const t = await mintToken('t');
    const res = await refreshRoute(request('/api/artifacts/assets/refresh', { method: 'POST', token: t.token, json: {} }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/my/artifacts/:id/assets/refresh — the menu row', () => {
  it('refreshes under a browser credential', async () => {
    const t = await mintToken('t');
    colour = 0x66;
    const made = await publishWithImage(t.token);
    const before = (await webAssetByHash(urlHash(`${web}/photo.png`)))!.object_key;

    colour = 0x77;
    const res = await myRefreshRoute(
      request(`/api/my/artifacts/${made.id}/assets/refresh`, { method: 'POST', cookie: await agentCookie([t.id]), origin: 'same' }),
      params({ id: made.id }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).refreshed).toEqual([`${web}/photo.png`]);
    expect((await webAssetByHash(urlHash(`${web}/photo.png`)))!.object_key).not.toBe(before);
  });

  it('is the uniform 404 for a document this browser does not own', async () => {
    const owner = await mintToken('owner');
    const other = await mintToken('other');
    const made = await publishWithImage(owner.token);
    const res = await myRefreshRoute(
      request(`/api/my/artifacts/${made.id}/assets/refresh`, { method: 'POST', cookie: await agentCookie([other.id]), origin: 'same' }),
      params({ id: made.id }),
    );
    expect(res.status).toBe(404);
  });
});
