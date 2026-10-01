/**
 * The offline bundles as the download reads them: built by
 * scripts/build-offline.mjs (run by the test global setup through
 * build-server-reader), gzip+base64 as `#afbin-code` stores them.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Script } from 'node:vm';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createAppServer } from '@/server/app';
import { EXTERNALS } from '../../../../../scripts/build/runtime-externals.mjs';
import { offlineBundle, offlineExtrasAsset, offlineExtrasRef } from '../bundle.server';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'lib/build-assets/offline/manifest.json'), 'utf8')) as {
  bundles: Record<'solid', { sha256: string; raw: number; gzip: number }>;
  extras: { file: string; path: string; integrity: string; sha256: string; raw: number };
};

describe('offlineBundle', () => {
  it('ships the runtime compiler beside the production server bundle', () => {
    expect(EXTERNALS).toContain('esbuild');
  });
  it('answers the Solid bundle as gzip+base64 of exactly the built code', async () => {
    const kind = 'solid';
    const code = gunzipSync(Buffer.from(await offlineBundle(kind), 'base64'));
    expect(code.length).toBe(manifest.bundles[kind].raw);
    expect(createHash('sha256').update(code).digest('hex')).toBe(manifest.bundles[kind].sha256);
    // ONE CLASSIC SCRIPT: it compiles as one, which module syntax or a stray
    // `import.meta` would not (both are SyntaxErrors outside a module).
    expect(() => new Script(code.toString('utf8'))).not.toThrow();
  });

  it('computes each bundle once per process', () => {
    expect(offlineBundle('solid')).toBe(offlineBundle('solid'));
  });

  it('keeps document engines and React out of the common Solid editor', async () => {
    const code = gunzipSync(Buffer.from(await offlineBundle('solid'), 'base64')).toString('utf8');
    for (const marker of ['mermaidAPI', 'flowchart-v2', 'Axes cannot be shared in concatenated', 'sqlite3.wasm', 'react.transitional.element']) {
      expect(code).not.toContain(marker);
    }
    expect(manifest.bundles.solid.raw).toBeLessThan(2 * 1024 * 1024);
  });
});

describe('the extras (the source editor and prettier), loaded on demand', () => {
  const code = async () => gunzipSync(Buffer.from(await offlineBundle('solid'), 'base64')).toString('utf8');

  it('are not in either bundle a file carries: those read them off the global the extras set', async () => {
    {
      const text = await code();
      // CodeMirror's editor core and prettier's printer, by strings only they contain.
      for (const marker of ['cm-scroller', 'prettier-ignore']) expect(text, `solid: ${marker}`).not.toContain(marker);
      expect(text).toContain('globalThis.__afbinExtras');
    }
    const extras = readFileSync(path.join(process.cwd(), 'lib/build-assets/offline', manifest.extras.file), 'utf8');
    for (const marker of ['cm-scroller', 'prettier-ignore', '__afbinExtras']) expect(extras).toContain(marker);
    // No React of its own: the file's bundle keeps components/SourceEditor, which mounts this engine.
    expect(extras).not.toContain('react.transitional.element');
    expect(() => new Script(extras)).not.toThrow();
  });

  it('are named by address and SRI hash, and served as exactly those bytes', async () => {
    const ref = await offlineExtrasRef();
    expect(ref.path).toMatch(/^\/offline\/extras-[0-9a-f]{16}\.js$/);
    const bytes = await offlineExtrasAsset(ref.path.slice('/offline/'.length));
    expect(bytes).not.toBeNull();
    expect(ref.integrity).toBe(`sha384-${createHash('sha384').update(bytes!).digest('base64')}`);
    expect(bytes!.length).toBe(manifest.extras.raw);
    expect(await offlineExtrasAsset('extras-0000000000000000.js')).toBeNull();
    expect(await offlineExtrasAsset('solid.js.gz')).toBeNull();
    expect(await offlineExtrasAsset('../manifest.json')).toBeNull();
  });

  it('are served immutable, CORS-open (a file:// page loads them with SRI) and as JavaScript', async () => {
    const app = createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>' });
    const ref = await offlineExtrasRef();
    const res = await app.request(ref.path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = Buffer.from(await res.arrayBuffer());
    expect(`sha384-${createHash('sha384').update(body).digest('base64')}`).toBe(ref.integrity);
    expect((await app.request('/offline/extras-0000000000000000.js')).status).toBe(404);
  });

  /*
   * A browser that takes brotli gets the sibling the build compressed once
   * (quality 11), never a per-request encode — and it still decodes to exactly
   * the bytes the SRI hash names.
   */
  it('are served as their build-time brotli or gzip sibling to a client that takes one', async () => {
    const app = createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>' });
    const ref = await offlineExtrasRef();
    const sri = (bytes: Buffer) => `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
    const br = await app.request(ref.path, { headers: { 'accept-encoding': 'gzip, deflate, br, zstd' } });
    expect(br.headers.get('content-encoding')).toBe('br');
    expect(br.headers.get('vary')).toMatch(/accept-encoding/i);
    expect(br.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const brBytes = Buffer.from(await br.arrayBuffer());
    expect(Number(br.headers.get('content-length'))).toBe(brBytes.byteLength);
    expect(brBytes.byteLength).toBeLessThan(manifest.extras.raw / 3);
    expect(sri(brotliDecompressSync(brBytes))).toBe(ref.integrity);
    const gz = await app.request(ref.path, { headers: { 'accept-encoding': 'gzip' } });
    expect(gz.headers.get('content-encoding')).toBe('gzip');
    expect(sri(gunzipSync(Buffer.from(await gz.arrayBuffer())))).toBe(ref.integrity);
    const head = await app.request(ref.path, { method: 'HEAD', headers: { 'accept-encoding': 'br' } });
    expect(head.headers.get('content-encoding')).toBe('br');
    expect(head.headers.get('content-length')).toBe(String(brBytes.byteLength));
    expect(await head.text()).toBe('');
  });
});
