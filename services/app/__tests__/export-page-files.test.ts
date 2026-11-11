/**
 * AN EXPORT CAPTURE LOADS ITS PAGE'S OWN PUBLISHED FILES AS ITS REQUESTER. The exporter photographs `raw?chrome=0&key=…`
 * in a browser with no session, so every request that page makes to its own asset door (a module script, a stylesheet
 * and what it names, an image, a file a script fetches through the runtime's file table) must carry the export key, or
 * a private page draws only its loading text for its own owner. Here the capture is served by the real raw route and
 * each address it names is asked of the real asset door, with the key and without it.
 */
import { expect, it } from 'vitest';
import { mintAccountToken, useAppHarness } from './harness';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { mintExportKey } from '@/lib/export';
import { GET as serveRaw } from '@/app/a/[id]/raw/route';
import { GET as serveAsset } from '@/app/a/[id]/assets/route';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const file = (path: string, text: string, contentType: string) => ({ path, contentType, base64: Buffer.from(text).toString('base64') });
const HTML = '<html><head><link rel="stylesheet" href="./main.css"></head><body><img src="./logo.svg" alt="logo"><p id="out"></p>'
  + '<script type="module" src="./app.mjs"></script></body></html>';
const FILES = [
  file('main.css', 'body{background:url(./logo.svg)}', 'text/css'),
  file('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'image/svg+xml'),
  file('app.mjs', "const data=await (await fetch('./data.json')).json();document.getElementById('out').textContent=data.total;", 'text/javascript'),
  file('data.json', '{"total":4242}', 'application/json'),
];

let pages = 0;
async function filesPage(visibility: 'private' | 'unlisted') {
  const minted = await mintAccountToken(`export_files_${visibility}_${++pages}`);
  const owner = identityForUser(minted.userId, minted.id, minted.email) as AccessActor & { tokenId: string };
  const response = await createArtifactFromBody({ visibility, html: HTML, publicationBundle: { entryPath: 'index.html', files: FILES } }, owner, BASE,
    new Request(`${BASE}/api/artifacts`, { method: 'POST', headers: { 'Idempotency-Key': `export_page_files_${visibility}_${pages}` } }));
  const saved = await response.json() as { id: string; dependencyReceipts: Array<{ path: string; id: string }> };
  expect(response.status, JSON.stringify(saved)).toBe(201);
  const receipt = (path: string) => saved.dependencyReceipts.find(entry => entry.path === path)!.id;
  return { owner, id: saved.id, receipts: { css: receipt('main.css'), logo: receipt('logo.svg'), script: receipt('app.mjs'), data: receipt('data.json') } };
}

/** The raw page as the capture (or a reader without a key) is served it. */
async function served(id: string, key: string | null) {
  const response = await serveRaw(new Request(`${BASE}/a/${id}/raw?chrome=0${key ? `&key=${encodeURIComponent(key)}` : ''}`), params(id));
  expect(response.status).toBe(200);
  return response.text();
}
const runtimeFiles = (html: string) =>
  (JSON.parse(/<script type="application\/json" data-af="runtime">([^<]*)<\/script>/.exec(html)![1]!) as { files?: Record<string, string> }).files ?? {};
/** Every address of `dependency` on the page's own asset door that `text` names (attribute-escaped or not). */
function addresses(text: string, id: string, dependency: string): string[] {
  const found = [...text.replaceAll('&amp;', '&').matchAll(new RegExp(`/a/${id}/assets\\?[^"'()\\s<>]*`, 'g'))].map(match => match[0]);
  return found.filter(address => new URL(address, BASE).searchParams.get('dependency') === dependency);
}
const withoutKey = (address: string) => { const url = new URL(address, BASE); url.searchParams.delete('key'); return url.pathname + url.search; };
const ask = (id: string, address: string) => serveAsset(new Request(new URL(address, BASE)), params(id));

it("admits a private page's capture requests for its script, stylesheet, image and fetched data file with the key, and refuses them without it", async () => {
  const { owner, id, receipts } = await filesPage('private');
  const key = mintExportKey(id, undefined, undefined, owner);
  const html = await served(id, key);
  const named = {
    script: addresses(html, id, receipts.script),
    stylesheet: addresses(html, id, receipts.css),
    image: addresses(html, id, receipts.logo),
    data: addresses(JSON.stringify(runtimeFiles(html)), id, receipts.data),
  };
  for (const [kind, found] of Object.entries(named)) {
    expect(found.length, kind).toBeGreaterThan(0);
    for (const address of found) {
      expect(new URL(address, BASE).searchParams.get('key'), kind).toBe(key);
      const admitted = await ask(id, address);
      expect(admitted.status, `${kind} ${withoutKey(address)}`).toBe(200);
      // Keyed bytes are the capture's alone: never kept by any cache.
      expect(admitted.headers.get('cache-control'), kind).toBe('no-store');
      if (kind === 'stylesheet') {
        // What the stylesheet names is asked from the same capture, so it carries the key too.
        const nested = addresses(await admitted.text(), id, receipts.logo);
        expect(nested.length).toBeGreaterThan(0);
        for (const inner of nested) {
          expect(new URL(inner, BASE).searchParams.get('key')).toBe(key);
          expect((await ask(id, inner)).status).toBe(200);
          expect((await ask(id, withoutKey(inner))).status).toBe(404);
        }
      }
      expect((await ask(id, withoutKey(address))).status, kind).toBe(404);
    }
  }
  // Another page's key, an expired key and a forged key admit nothing.
  const other = await filesPage('private');
  const address = withoutKey(named.image[0]!);
  for (const wrong of [mintExportKey(other.id, undefined, undefined, other.owner), mintExportKey(id, -1, undefined, owner), `${key.slice(0, -1)}${key.endsWith('0') ? '1' : '0'}`])
    expect((await ask(id, `${address}&key=${encodeURIComponent(wrong)}`)).status).toBe(404);
  // The key is never written into what is stored.
  const stored = (await (await getDb()).query<{ source: string; meta: unknown }>('SELECT source, meta FROM artifacts WHERE id=$1', [id])).rows[0]!;
  expect(stored.source + JSON.stringify(stored.meta)).not.toContain(key);
  expect(addresses(stored.source, id, receipts.css).some(found => new URL(found, BASE).searchParams.has('key'))).toBe(false);
});

it('serves an unlisted page as before: a page read without a key names no key, and its files are admitted with or without one', async () => {
  const { owner, id, receipts } = await filesPage('unlisted');
  const plain = await served(id, null);
  for (const dependency of Object.values(receipts)) {
    const found = [...addresses(plain, id, dependency), ...addresses(JSON.stringify(runtimeFiles(plain)), id, dependency)];
    expect(found.length, dependency).toBeGreaterThan(0);
    for (const address of found) {
      expect(new URL(address, BASE).searchParams.has('key')).toBe(false);
      const answer = await ask(id, address);
      expect(answer.status).toBe(200);
      expect(answer.headers.get('cache-control')).toBe('private, no-cache');
    }
  }
  const html = await served(id, mintExportKey(id, undefined, undefined, owner));
  for (const address of addresses(html, id, receipts.css)) expect((await ask(id, address)).status).toBe(200);
});

it("admits the files of the archived version a capture shows, on the capture's key alone", async () => {
  const { owner, id, receipts } = await filesPage('private');
  // Version 1 archived as it was published, and the head moved on to version 2.
  const db = await getDb();
  await db.query("INSERT INTO artifact_versions (artifact_id, version, title, description, format, source, meta) SELECT id, 1, title, description, format, source, meta FROM artifacts WHERE id=$1", [id]);
  await db.query('UPDATE artifacts SET version=2 WHERE id=$1', [id]);
  const key = mintExportKey(id, undefined, undefined, owner);
  const response = await serveRaw(new Request(`${BASE}/a/${id}/raw?chrome=0&key=${encodeURIComponent(key)}&version=1`), params(id));
  expect(response.status).toBe(200);
  const found = addresses(await response.text(), id, receipts.logo);
  expect(found.length).toBeGreaterThan(0);
  for (const address of found) {
    expect(new URL(address, BASE).searchParams.get('version')).toBe('1');
    expect((await ask(id, address)).status).toBe(200);
    expect((await ask(id, withoutKey(address))).status).toBe(404);
  }
});
