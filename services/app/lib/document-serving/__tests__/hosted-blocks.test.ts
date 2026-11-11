/**
 * The pinned building blocks a host page loads (lib/document-serving/hosted-blocks.server), through the real routes:
 * the manifest names every public component, the stylesheets and the host module at immutable addresses with their
 * integrity; a bundle a later deploy no longer builds keeps answering its exact bytes from retention; a digest is
 * answered only as the kind it was stored as; and the flat addresses pages use are untouched.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { GET as manifestRoute } from '@/app/af/manifest.json/route';
import { GET as pinnedComponent } from '@/app/af/v1/components/[digest]/[file]/route';
import { GET as pinnedStyles } from '@/app/af/v1/styles/[file]/route';
import { GET as pinnedHost } from '@/app/af/v1/host/[file]/route';
import { GET as flatHost } from '@/app/af/host.js/route';
import { GET as flatComponent } from '@/app/af/components/[file]/route';
import { retainedPublicAssets } from '@/lib/html-runtime/server';
import { HTML_SYSTEM_NAMES, THEME_TOKENS } from '@/lib/html-systems';
import hosted from '../../html-components/hosted.json';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();
const APP = 'https://app.example.test';
const sri = (body: string | Buffer) => `sha384-${createHash('sha384').update(body).digest('base64')}`;
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');
interface Manifest {
  version: number; components: Record<string, string>; styles: string; host: string; fonts: string;
  designSystems: Record<string, { label: string; defaultMode: string; styles: string }>;
  theme: { attributes: Record<string, string>; tokens: string[]; optionalTokens: string[] }; integrity: Record<string, string>;
}
/** Any pinned address, through its route. */
async function pinned(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const request = new Request(APP + url, { headers });
  const parts = url.split('/');
  if (url.startsWith('/af/v1/components/')) return pinnedComponent(request, { params: Promise.resolve({ digest: parts[4]!, file: parts[5]! }) });
  if (url.startsWith('/af/v1/styles/')) return pinnedStyles(request, { params: Promise.resolve({ file: parts[4]! }) });
  if (url.startsWith('/af/v1/host/')) return pinnedHost(request, { params: Promise.resolve({ file: parts[4]! }) });
  throw Error(url);
}
const manifest = async () => {
  const response = await manifestRoute(new Request(`${APP}/af/manifest.json`));
  expect(response.headers.get('cache-control')).toBe('no-cache');
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  return await response.json() as Manifest;
};

it('names every public component, the stylesheets and the host module at immutable addresses with their integrity', async () => {
  const m = await manifest();
  expect(m.version).toBe(1);
  expect(Object.keys(m.components).sort()).toEqual([...hosted.components].sort());
  expect(Object.keys(m.designSystems).sort()).toEqual([...HTML_SYSTEM_NAMES].sort());
  expect(m.theme.tokens).toEqual([...THEME_TOKENS]);
  expect(m.fonts).toBe('/af/fonts/');
  const built = (file: string) => readFileSync(path.resolve('lib/build-assets/components', file));
  for (const [name, url] of Object.entries(m.components)) {
    const response = await pinned(url);
    expect(response.status, name).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cross-origin-resource-policy')).toBeNull();
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(built(`${name}.js`)), name).toBe(true);
    expect(m.integrity[url], name).toBe(sri(body));
    // Its chunks resolve inside the same pinned bundle, and are listed with their integrity.
    for (const [, chunk] of body.toString('utf8').matchAll(/["']\.\/(chunk-[a-z0-9]+\.js)["']/g)) {
      const chunkUrl = new URL(`./${chunk}`, APP + url).pathname;
      expect(m.integrity[chunkUrl], chunkUrl).toBeDefined();
      expect((await pinned(chunkUrl)).status, chunkUrl).toBe(200);
    }
  }
  const all = await pinned(m.styles);
  expect(all.headers.get('content-type')).toMatch(/^text\/css/);
  const allCss = await all.text();
  expect(m.integrity[m.styles]).toBe(sri(allCss));
  for (const name of HTML_SYSTEM_NAMES) expect(allCss).toContain(`:root[data-af-design-system="${name}"]`);
  const one = await (await pinned(m.designSystems.meridian!.styles)).text();
  expect(one).toContain(':root[data-af-design-system="meridian"]');
  expect(one).not.toContain(':root[data-af-design-system="almanac"]');
  const host = await pinned(m.host);
  expect(host.headers.get('content-type')).toMatch(/^text\/javascript/);
  const hostSource = await host.text();
  expect(hostSource).toBe(await (await flatHost(new Request(`${APP}/af/host.js`))).text());
  expect(hostSource).toContain('mountDocument');
  expect(m.integrity[m.host]).toBe(sri(hostSource));
  const repeat = await pinned(m.host, { 'if-none-match': host.headers.get('etag')! });
  expect(repeat.status).toBe(304);
});

it('keeps answering a bundle an earlier deploy built, and refuses what it never stored or that was tampered with', async () => {
  const older = JSON.stringify({ files: { 'button.js': 'export const release = 0;', 'chunk-old0.js': 'export {};' } });
  await retainedPublicAssets('components', 'application/json; charset=utf-8').put(sha256(older), older);
  const answer = await pinned(`/af/v1/components/${sha256(older)}/button.js`);
  expect(answer.status).toBe(200);
  expect(await answer.text()).toBe('export const release = 0;');
  expect((await pinned(`/af/v1/components/${sha256(older)}/chunk-old0.js`)).status).toBe(200);
  expect((await pinned(`/af/v1/components/${sha256(older)}/tabs.js`)).status).toBe(404);
  const forged = sha256('another');
  await retainedPublicAssets('components', 'application/json; charset=utf-8').put(forged, older);
  expect((await pinned(`/af/v1/components/${forged}/button.js`)).status).toBe(404);
  expect((await pinned(`/af/v1/components/${'0'.repeat(64)}/button.js`)).status).toBe(404);
  expect((await pinned('/af/v1/components/nothex/button.js')).status).toBe(404);
});

it('answers a digest only as the kind it was stored as', async () => {
  const m = await manifest();
  const styles = m.styles.split('/').pop()!.replace('.css', '');
  const host = m.host.split('/').pop()!.replace('.js', '');
  const bundle = Object.values(m.components)[0]!.split('/')[4]!;
  expect((await pinned(`/af/v1/host/${styles}.js`)).status).toBe(404);
  expect((await pinned(`/af/v1/styles/${host}.css`)).status).toBe(404);
  expect((await pinned(`/af/v1/styles/${bundle}.css`)).status).toBe(404);
  expect((await pinned(`/af/v1/styles/${styles}.js`)).status).toBe(404);
});

it('leaves the flat addresses pages load as they were', async () => {
  const entry = await flatComponent(new Request(`${APP}/af/components/button.js`), { params: Promise.resolve({ file: 'button.js' }) });
  expect(entry.status).toBe(200);
  expect(entry.headers.get('cache-control')).toBe('no-cache');
  const hostModule = await flatHost(new Request(`${APP}/af/host.js`));
  expect(hostModule.headers.get('cache-control')).toBe('no-cache');
  expect(hostModule.headers.get('access-control-allow-origin')).toBe('*');
});
