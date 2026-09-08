import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { useAppHarness, request } from './harness';
import { POST as create } from '@/app/api/artifacts/route';
import { GET as exportImage } from '@/app/a/[id]/export/route';
import { mintToken } from '@/lib/tokens';
import { createUser } from '@/lib/users';
import { getDb } from '@/lib/db';
import { getArtifactById } from '@/lib/artifacts';
import { setServices } from '@/lib/services';
import { fakeBrowser } from '@artifactbin/utils';
import { resetExportRenderer } from '@/lib/export';

useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const markup = (id: string) => `<Helmet><meta name="artifactbin:og-image" content="ref:${id}" /><meta name="artifactbin:og-crop" content="x=0;y=20;width=800" /></Helmet><p>Document</p>`;
const publish = (token: string, body: unknown) => create(request('/api/artifacts', { method: 'POST', token, json: body }));

async function fixture() {
  const user = await createUser({ email: `social-${crypto.randomUUID()}@example.com` });
  const { token } = await mintToken('social image', user.id);
  const bytes = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const imageRes = await publish(token, { image: `data:image/png;base64,${bytes.toString('base64')}`, visibility: 'private' });
  expect(imageRes.status).toBe(201);
  return { token, image: await imageRes.json() };
}

describe('uploaded social preview cards', () => {
  it('binds an image and returns a real 1600×840 PNG/JPEG without the browser', async () => {
    const { token, image } = await fixture();
    const res = await publish(token, { markup: markup(image.id), visibility: 'unlisted' });
    expect(res.status).toBe(201);
    const doc = await res.json();
    expect((await getArtifactById(doc.id))!.meta).toMatchObject({ refs: expect.arrayContaining([{ id: image.id, kind: 'image' }]) });
    setServices({ browser: fakeBrowser({ ok: false, reason: 'unavailable' }) });
    try {
      for (const format of ['png', 'jpg']) {
        const card = await exportImage(request(`/a/${doc.id}/export?mode=card&format=${format}`), params(doc.id));
        expect(card.status).toBe(200);
        const pixels = sharp(Buffer.from(await card.arrayBuffer()));
        expect(await pixels.metadata()).toMatchObject({ width: 1600, height: 840, format: format === 'jpg' ? 'jpeg' : 'png' });
        const { data } = await pixels.raw().toBuffer({ resolveWithObject: true });
        expect(data[0]).toBeGreaterThan(240);
        expect(data[1]).toBeLessThan(10);
      }
      const full = await exportImage(request(`/a/${doc.id}/export`, { token }), params(doc.id));
      expect(full.status).toBe(503);
    } finally { await resetExportRenderer(); setServices({}); }
  });

  it('enforces the document ACL and falls back to framing when an image is trashed', async () => {
    const { token, image } = await fixture();
    const doc = await (await publish(token, { markup: markup(image.id), visibility: 'private' })).json();
    expect((await exportImage(request(`/a/${doc.id}/export?mode=card`), params(doc.id))).status).toBe(404);
    await (await getDb()).query('UPDATE artifacts SET deleted_at = now() WHERE id = $1', [image.id]);
    const bytes = new Uint8Array([1, 2, 3]);
    setServices({ browser: fakeBrowser({ ok: true, mime: 'image/png', bytes }) });
    try {
      const card = await exportImage(request(`/a/${doc.id}/export?mode=card`, { token }), params(doc.id));
      expect(card.status).toBe(200);
      expect(new Uint8Array(await card.arrayBuffer())).toEqual(bytes);
    } finally { await resetExportRenderer(); setServices({}); }
  });

  it('rejects non-image, missing, and malformed references at publish', async () => {
    const { image } = await fixture();
    const { token } = await mintToken('invalid social image');
    const dataset = await (await publish(token, { dataset: [{ x: 1 }] })).json();
    for (const value of [`ref:${dataset.id}`, 'ref:missing', `ref:${image.id}`, 'https://example.com/image.png']) {
      const res = await publish(token, { markup: `<Helmet><meta name="artifactbin:og-image" content="${value}" /></Helmet><p>x</p>` });
      expect(res.status).toBe(400);
    }
  });
});

it('exports the selected image region and serves the uncropped image only to editors', async () => {
  const { token } = await fixture();
  const blue = await sharp({ create: { width: 80, height: 160, channels: 3, background: '#0000ff' } }).png().toBuffer();
  const bytes = await sharp({ create: { width: 160, height: 160, channels: 3, background: '#ff0000' } })
    .composite([{ input: blue, left: 80, top: 0 }]).png().toBuffer();
  const asset = await (await publish(token, { image: `data:image/png;base64,${bytes.toString('base64')}`, visibility: 'private' })).json();
  const source = markup(asset.id).replace('</Helmet>', '<meta name="artifactbin:og-image-crop" content="x=800;y=600;width=800" /></Helmet>');
  const created = await publish(token, { markup: source, visibility: 'unlisted' });
  expect(created.status).toBe(201);
  const doc = await created.json();
  const card = await exportImage(request(`/a/${doc.id}/export?mode=card`), params(doc.id));
  expect(card.status).toBe(200);
  const rendered = sharp(Buffer.from(await card.arrayBuffer()));
  expect(await rendered.metadata()).toMatchObject({ width: 1600, height: 840 });
  const pixel = await rendered.resize(1, 1).raw().toBuffer();
  expect(pixel[2]).toBeGreaterThan(240);
  expect(pixel[0]).toBeLessThan(15);
  const url = `/a/${doc.id}/export?mode=preview&image=1`;
  expect((await exportImage(request(url), params(doc.id))).status).toBe(404);
  const overview = await exportImage(request(url, { token }), params(doc.id));
  expect(overview.status).toBe(200);
  expect(overview.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await sharp(Buffer.from(await overview.arrayBuffer())).metadata()).toMatchObject({ width: 160, height: 160 });
});
