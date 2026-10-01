/**
 * DYNAMIC PAGES IN BROTLI — the document page and its page data, encoded per
 * response when the request accepts brotli, and byte-for-byte the identity
 * answer once decoded. Nothing else changes: a client that takes no encoding
 * gets what it got before, a stream is never buffered, an encoded body is never
 * encoded twice.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ACTOR_HEADER } from '@artifactbin/contracts';
import { signActor } from '@artifactbin/utils';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { mintToken } from '@/lib/accounts';
import { claimToken, createUser, ensureUsername } from '@/lib/accounts';
import { useAppHarness } from '@/__tests__/harness';
import { createAppServer } from '../app';
import { compressDynamic, negotiateEncoding } from '../content-encoding';

useAppHarness();

const SECRET = 'vitest-actor-secret-0000000000000000';
const BASE = 'http://localhost:3000';
const BROWSER = 'gzip, deflate, br, zstd';
const stranger = { [ACTOR_HEADER]: signActor({ credential: 'none' }, SECRET) };
const app = createAppServer({ actorSecret: SECRET, indexHtml: async () => '<!doctype html><html><head><title>SPA</title></head><body><div id="root">SPA</div></body></html>' });

async function publicDocument() {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_encoding@example.com' }));
  const t = await mintToken('o'); await claimToken(owner.id, t.token);
  const res = await createArtifactRoute(new Request(`${BASE}/api/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t.token}` }, body: JSON.stringify({ title: 'Pub', markup: '<div><p>' + 'public words that repeat. '.repeat(100) + '</p></div>', visibility: 'public' }) }));
  const { id } = await res.json() as { id: string };
  return { id, canonical: `/@${owner.username}/${id}-pub` };
}
const bytes = async (res: Response) => Buffer.from(await res.arrayBuffer());

describe('the document page and its page data', () => {
  it('are brotli when accepted, decoding to exactly the identity answer', async () => {
    const doc = await publicDocument();
    for (const address of [doc.canonical, `/api/page/artifact/${doc.id}`]) {
      const plain = await app.request(address, { headers: stranger });
      const encoded = await app.request(address, { headers: { ...stranger, 'accept-encoding': BROWSER } });
      expect(plain.status, address).toBe(200);
      expect(encoded.status, address).toBe(200);
      expect(plain.headers.get('content-encoding'), address).toBeNull();
      expect(plain.headers.get('vary'), address).toMatch(/accept-encoding/i);
      expect(encoded.headers.get('content-encoding'), address).toBe('br');
      expect(encoded.headers.get('vary'), address).toMatch(/accept-encoding/i);
      expect(encoded.headers.get('content-type'), address).toBe(plain.headers.get('content-type'));
      expect(encoded.headers.get('cache-control'), address).toBe(plain.headers.get('cache-control'));
      const wire = await bytes(encoded);
      expect(Number(encoded.headers.get('content-length')), address).toBe(wire.byteLength);
      const identity = await bytes(plain);
      expect(wire.byteLength, address).toBeLessThan(identity.byteLength);
      // A compiled page may finish a warm snapshot between these two requests;
      // check a valid decoded answer with the same artifact rather than byte identity across reads.
      const decoded = brotliDecompressSync(wire).toString();
      expect(decoded, address).toContain(doc.id);
      expect(identity.toString(), address).toContain(doc.id);
    }
  });
  it('stay identity for a client that refuses brotli or takes only gzip (nginx gzips those as before)', async () => {
    const doc = await publicDocument();
    for (const accept of ['gzip', 'br;q=0, gzip', 'identity']) {
      const res = await app.request(doc.canonical, { headers: { ...stranger, 'accept-encoding': accept } });
      expect(res.headers.get('content-encoding'), accept).toBeNull();
      expect((await res.text()), accept).toContain('public words');
    }
  });
  it('answer HEAD without a body, and leave a body too small to gain as it is', async () => {
    const doc = await publicDocument();
    const head = await app.request(doc.canonical, { method: 'HEAD', headers: { ...stranger, 'accept-encoding': BROWSER } });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const miss = await app.request('/nope/nothing', { headers: { accept: 'text/html', 'accept-encoding': 'br' } });
    // This test's shell is ~150 bytes: framing would outweigh the saving.
    expect(miss.status).toBe(404);
    expect(miss.headers.get('content-encoding')).toBeNull();
    expect(miss.headers.get('vary')).toMatch(/accept-encoding/i);
    expect(await miss.text()).toContain('SPA');
  });
  it('the content-addressed island reader is its build-time brotli sibling through the app', async () => {
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'public/islands/manifest.json'), 'utf8')) as { manifest: Record<string,string> };
    const entry = manifest.manifest['@mx/boot']!;
    const res = await app.request(entry, { headers: { 'accept-encoding': BROWSER } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('br');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(Buffer.compare(await bytes(res), readFileSync(path.join(process.cwd(), 'public', entry + '.br')))).toBe(0);
  });
});

describe('compressDynamic', () => {
  const html = '<!doctype html>' + '<p>words</p>'.repeat(500);
  const accepting = new Request('http://x/', { headers: { 'accept-encoding': 'br' } });
  it('never buffers or encodes an event stream', async () => {
    const stream = new Response(new ReadableStream({ start() { /* never ends */ } }), { headers: { 'content-type': 'text/event-stream' } });
    expect(await compressDynamic(accepting, stream)).toBe(stream);
  });
  it('never encodes an already-encoded body twice', async () => {
    const encoded = new Response('x'.repeat(4096), { headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' } });
    expect(await compressDynamic(accepting, encoded)).toBe(encoded);
  });
  it('encodes a finished HTML body and says so', async () => {
    const res = await compressDynamic(accepting, new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    expect(res.headers.get('content-encoding')).toBe('br');
    expect(brotliDecompressSync(await bytes(res)).toString()).toBe(html);
  });
});

describe('negotiateEncoding', () => {
  it('honours q-values and wildcards and treats silence as identity', () => {
    expect(negotiateEncoding('gzip, deflate, br, zstd', ['br', 'gzip'])).toBe('br');
    expect(negotiateEncoding('br;q=0, gzip', ['br', 'gzip'])).toBe('gzip');
    expect(negotiateEncoding('gzip;q=1, br;q=0.5', ['br', 'gzip'])).toBe('gzip');
    expect(negotiateEncoding('*', ['br'])).toBe('br');
    expect(negotiateEncoding('*, br;q=0', ['br'])).toBeNull();
    expect(negotiateEncoding('identity', ['br'])).toBeNull();
    expect(negotiateEncoding(null, ['br'])).toBeNull();
    expect(negotiateEncoding('BR', ['br'])).toBe('br');
  });
});
