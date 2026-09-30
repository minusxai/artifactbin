import { expect, it } from 'vitest';
import sharp from 'sharp';
import { ACTOR_HEADER } from '@artifactbin/contracts';
import { signActor } from '@artifactbin/utils';
import { createAppServer } from '../app';
import { useAppHarness } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';
import { mintExportKey } from '@/lib/export-key';

const harness = useAppHarness();
const secret = 'vitest-actor-secret-0000000000000000';
const app = createAppServer({ actorSecret: secret, indexHtml: async () => '<html><head><title>artifactbin</title></head><body><div id="root"></div></body></html>' });
async function world() {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_pwa@example.com' }));
  const token = await mintToken('pwa');
  await claimToken(owner.id, token.token);
  const make = async (visibility: 'public' | 'private') => (await (await createArtifactRoute(new Request('http://localhost/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token.token}` }, body: JSON.stringify({ markup: '<h1>Live app</h1>', title: 'My app <&>', visibility }) }))).json()) as { id: string };
  return { public: await make('public'), private: await make('private'), headers: { [ACTOR_HEADER]: signActor({ credential: 'session', userId: owner.id, email: owner.email }, secret) } };
}

it('serves an authorized app at its stable address with manifest discovery and no canonical redirect', async () => {
  const w = await world();
  const response = await app.request(`/a/${w.public.id}/app/`);
  expect(response.status).toBe(200);
  expect(response.headers.get('location')).toBeNull();
  const html = await response.text();
  expect(html).toContain(`rel="manifest" href="/a/${w.public.id}/app/manifest.webmanifest" crossorigin="use-credentials"`);
  expect(html).toContain('rel="apple-touch-icon"');
  expect(html).toContain('Live app');
  expect(html).toContain('mx-page-data');
  expect(html).not.toContain('"address":');
});

it('gives each artifact a distinct stable identity, scope and PNG icons', async () => {
  const w = await world();
  const base = `/a/${w.public.id}/app/`;
  const res = await app.request(`${base}manifest.webmanifest?version=1&key=ignored`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('application/manifest+json');
  expect(res.headers.get('cache-control')).toBe('no-store');
  const manifest = await res.json();
  expect(manifest).toMatchObject({ id: base, start_url: base, scope: base, name: 'My app <&>', display: 'standalone' });
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(['192x192', '512x512']);
  const second = await (await app.request(`/a/${w.private.id}/app/manifest.webmanifest`, { headers: w.headers })).json();
  expect(second.id).not.toBe(manifest.id);
  for (const icon of manifest.icons) {
    const response = await app.request(icon.src);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect(`${metadata.width}x${metadata.height}`).toBe(icon.sizes);
  }
});

it('protects app pages, manifest metadata and icons, including after access is revoked', async () => {
  const w = await world();
  const denied = await app.request(`/a/${w.private.id}/app/?key=${mintExportKey(w.private.id)}`, { headers: { accept: 'text/html' } });
  expect(denied.status).toBe(404);
  expect((await denied.text()).includes('Live app')).toBe(false);
  for (const suffix of ['', 'manifest.webmanifest', 'icon-192.png']) {
    const url = `/a/${w.private.id}/app/${suffix}`;
    expect((await app.request(url)).status).toBe(404);
    expect((await app.request(url, { headers: w.headers })).status).toBe(200);
    expect((await app.request(`/a/Absent1/app/${suffix}`)).status).toBe(404);
  }
  const db = await harness.db();
  await db.query('UPDATE artifacts SET visibility=$1 WHERE id=$2', ['private', w.public.id]);
  expect((await app.request(`/a/${w.public.id}/app/manifest.webmanifest`)).status).toBe(404);
  expect((await app.request(`/a/${w.public.id}/app/`)).status).toBe(404);
});

it('publishes a separate admitted icon and settings, while refusing foreign private icons', async () => {
  const w = await world();
  const ownerToken = await mintToken('icons');
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_icons@example.com' }));
  await claimToken(owner.id, ownerToken.token);
  const create = (body: Record<string, unknown>, token = ownerToken.token) => createArtifactRoute(new Request('http://localhost/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
  const image = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const upload = await create({ image: `data:image/png;base64,${image.toString('base64')}`, visibility: 'private' });
  expect(upload.status).toBe(201);
  const icon = await upload.json();
  const markup = `<Helmet><meta name="artifactbin:pwa-name" content="Separate app" /><meta name="artifactbin:pwa-short-name" content="App" /><meta name="artifactbin:pwa-theme-color" content="#112233" /><meta name="artifactbin:pwa-icon" content="ref:${icon.id}" /></Helmet><h1>Original title</h1>`;
  const published = await create({ markup, visibility: 'public' });
  expect(published.status).toBe(201);
  const doc = await published.json();
  const base = `/a/${doc.id}/app/`;
  const manifest = await (await app.request(`${base}manifest.webmanifest`)).json();
  expect(manifest).toMatchObject({ name: 'Separate app', short_name: 'App', theme_color: '#112233' });
  const png = await app.request(`${base}icon-192.png`);
  const { data, info } = await sharp(Buffer.from(await png.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
  const middle = (96 * info.width + 96) * info.channels;
  expect(data[middle]).toBeGreaterThan(240);
  expect(data[middle + 1]).toBeLessThan(15);
  // Neither the stored image nor a different owner's document becomes readable by guessing its id.
  expect((await app.request(`/a/${icon.id}/app/icon-192.png`)).status).toBe(404);
  const other = await mintToken('foreign');
  const refused = await create({ markup }, other.token);
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({ error: 'invalid_refs' });
  expect((await app.request(`/a/${w.private.id}/app/icon-512.png`)).status).toBe(404);
});
