/**
 * PRECOMPRESSED SIBLINGS — written by the build step that writes their sources,
 * so a served variant is always the same content-addressed file, never a stale
 * copy beside a rebuilt one.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { precompressTree } from '../lib/precompress.mjs';

const dirs = [];
const tree = () => { const dir = mkdtempSync(path.join(os.tmpdir(), 'precompress-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const text = (words) => ('const value = "' + words + '";\n').repeat(200);

describe('precompressTree', () => {
  it('writes brotli and gzip siblings that decode to the exact source bytes, nested included', async () => {
    const dir = tree();
    mkdirSync(path.join(dir, 'chunks'));
    const files = { 'entry-abc.js': text('entry'), 'chunks/lazy-def.js': text('lazy'), 'style-1.css': 'body{color:red}\n'.repeat(300), 'manifest.json': JSON.stringify({ a: text('m') }), 'engine.wasm': Buffer.alloc(8192, 7) };
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
    const report = await precompressTree(dir);
    for (const [name, body] of Object.entries(files)) {
      const source = Buffer.from(body);
      expect(Buffer.compare(brotliDecompressSync(readFileSync(path.join(dir, name + '.br'))), source), name).toBe(0);
      expect(Buffer.compare(gunzipSync(readFileSync(path.join(dir, name + '.gz'))), source), name).toBe(0);
    }
    expect(report.files).toBe(5);
    expect(report.br).toBeLessThan(report.source);
  });

  it('leaves already-compressed, tiny and unknown files alone', async () => {
    const dir = tree();
    writeFileSync(path.join(dir, 'font-abc.woff2'), Buffer.alloc(8192, 1));
    writeFileSync(path.join(dir, 'picture.png'), Buffer.alloc(8192, 1));
    writeFileSync(path.join(dir, 'tiny.js'), 'x');
    await precompressTree(dir);
    for (const name of ['font-abc.woff2', 'picture.png', 'tiny.js']) {
      expect(existsSync(path.join(dir, name + '.br')), name).toBe(false);
      expect(existsSync(path.join(dir, name + '.gz')), name).toBe(false);
    }
  });

  it('never leaves a variant that disagrees with its source', async () => {
    const dir = tree();
    const file = path.join(dir, 'lib-1.0.0.js');
    writeFileSync(file, text('first'));
    await precompressTree(dir);
    // A rebuilt source at the same (version-addressed) name: its old siblings must not survive.
    writeFileSync(file, text('second'));
    await precompressTree(dir);
    expect(brotliDecompressSync(readFileSync(file + '.br')).toString()).toBe(text('second'));
    // A source that shrank below the threshold keeps no stale sibling at all.
    writeFileSync(file, 'x');
    await precompressTree(dir);
    expect(existsSync(file + '.br')).toBe(false);
    expect(existsSync(file + '.gz')).toBe(false);
    // An orphaned sibling (its source deleted) is removed too.
    writeFileSync(path.join(dir, 'gone.js.br'), 'stale');
    await precompressTree(dir);
    expect(existsSync(path.join(dir, 'gone.js.br'))).toBe(false);
  });
});
