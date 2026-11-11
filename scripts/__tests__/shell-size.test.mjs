/**
 * SIZE TARGET 4 ON EVERY PULL REQUEST: the app shell's JS before the document frame is ready (scripts/build/size-targets.mjs),
 * judged from a real client build (the same Vite config, into a temporary directory) in the build's own bytes
 * (scripts/lib/shell-graph.mjs `shellWireBytes`), which reproduce the page-speed lab's count exactly. That lab runs on
 * main after a merge, so before this a pull request could carry the shell past its target unseen: #1236 measured
 * 51,232 bytes against 51,200 and failed main's page speed report.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { evaluateSizeTargets, SIZE_TARGETS } from '../build/size-targets.mjs';
import { GATEWAY_CHUNK_FRAMING, shellWireBytes } from '../lib/shell-graph.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SHELL_TARGET = SIZE_TARGETS.find((target) => target.id === 4);
const temporary = [];
const scratch = () => { const dir = mkdtempSync(path.join(tmpdir(), 'shell-size-')); temporary.push(dir); return dir; };
afterAll(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

/** Target 4 judged for a shell of `gzip` bytes: the shell is the same on every page kind the target lists. */
const judge = (gzip) => evaluateSizeTargets(Object.fromEntries([...SHELL_TARGET.fixtures, ...SHELL_TARGET.optional]
  .map((key) => [key, { [SHELL_TARGET.route]: { [SHELL_TARGET.metric]: gzip } }]))).find((row) => row.id === SHELL_TARGET.id);

describe('the shell bytes of a build', () => {
  it('counts a brotli sibling as sent, the gateway gzip and its framing without one, and only executable inline scripts', () => {
    const web = scratch();
    mkdirSync(path.join(web, '.vite'), { recursive: true });
    mkdirSync(path.join(web, 'af/app'), { recursive: true });
    writeFileSync(path.join(web, '.vite/manifest.json'), JSON.stringify({
      'solid-app.html': { file: 'af/app/entry-1.js', isEntry: true, imports: ['_small-2.js'] },
      '_small-2.js': { file: 'af/app/small-2.js' },
      '../solid/pages/Document.tsx': { file: 'af/app/Document-3.js' },
    }));
    writeFileSync(path.join(web, 'af/app/entry-1.js'), 'x'.repeat(4000));
    writeFileSync(path.join(web, 'af/app/entry-1.js.br'), Buffer.alloc(120));
    writeFileSync(path.join(web, 'af/app/small-2.js'), 'export const small = 1;');
    writeFileSync(path.join(web, 'af/app/Document-3.js'), 'y'.repeat(3000));
    writeFileSync(path.join(web, 'af/app/Document-3.js.br'), Buffer.alloc(80));
    const inline = 'document.documentElement.dataset.theme = "dark";';
    writeFileSync(path.join(web, 'solid-app.html'), `<script type="importmap">{"imports":{}}</script><script type="application/json">{"a":1}</script><script>${inline}</script><script type="module" src="/af/app/entry-1.js"></script>`);
    const bytes = shellWireBytes(web);
    const small = gzipSync('export const small = 1;').length + GATEWAY_CHUNK_FRAMING;
    expect(bytes.inline).toBe(gzipSync(inline).length);
    expect(bytes.gzip).toBe(120 + 80 + small + bytes.inline);
  });

  it('judges target 4 with its own limit, failing one byte past it', () => {
    expect(judge(SHELL_TARGET.limit).verdict).toBe('pass');
    expect(judge(SHELL_TARGET.limit + 1).verdict).toBe('fail');
  });
});

describe('size target 4 on this tree', () => {
  it('keeps the app shell within its target', { timeout: 50_000 }, async () => {
    const out = scratch();
    // The production build, as CI's: under Vitest's NODE_ENV=test, Vite would bundle Solid's development builds.
    await promisify(execFile)(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--config', path.join(ROOT, 'vite.config.mts'), '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NODE_ENV: 'production' } });
    const bytes = shellWireBytes(out);
    const row = judge(bytes.gzip);
    const largest = [...bytes.scripts].sort((a, b) => b.bytes - a.bytes).slice(0, 6).map((script) => `${script.file} ${script.bytes}`).join(', ');
    console.log(`[shell size] ${bytes.gzip} bytes (inline ${bytes.inline}) against ${SHELL_TARGET.limit}: ${largest}`);
    expect(row.verdict, `the app shell's eager JS is ${bytes.gzip} bytes, over size target 4's ${SHELL_TARGET.limit} (largest: ${largest}). Move what a document view does not need at once behind a lazy import; never raise the target.`).toBe('pass');
  });
});
