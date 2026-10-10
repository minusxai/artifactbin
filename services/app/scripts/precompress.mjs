/**
 * PRECOMPRESSED SIBLINGS for a content-addressed static tree: `<file>.br`
 * (brotli, quality 11) and `<file>.gz` (gzip, level 9) beside every text-like
 * file worth compressing, so the server answers a browser with bytes compressed
 * once at build time instead of on every request (server/content-encoding).
 *
 * Called by the step that WRITES the sources (the Vite build, the story
 * runtime and library builds, the offline extras), never as a later pass, so a
 * sibling can only ever describe the file beside it: every run first removes
 * the siblings it finds, then writes fresh ones. A sibling is written only when
 * it is smaller than its source; without one, the source is served as it is.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/** Text-like content worth compressing. woff2, images and archives are already compressed. */
const PRECOMPRESSIBLE = /\.(?:js|mjs|css|json|wasm|svg|map|txt|html)$/;
/** The encodings a sibling may carry, by file suffix. */
const SIBLINGS = ['.br', '.gz'];
/** Below this, the headers outweigh any saving. */
const MIN_BYTES = 256;

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else if (entry.isFile()) yield file;
  }
}

/** Write (or remove) the siblings of ONE source file. Returns the bytes written, or null when none were. */
export async function precompressFile(file) {
  await Promise.all(SIBLINGS.map(suffix => fs.rm(file + suffix, { force: true })));
  if (!PRECOMPRESSIBLE.test(file)) return null;
  const source = await fs.readFile(file);
  if (source.byteLength < MIN_BYTES) return null;
  const mode = file.endsWith('.wasm') ? zlib.constants.BROTLI_MODE_GENERIC : zlib.constants.BROTLI_MODE_TEXT;
  const [br, gz] = await Promise.all([
    brotli(source, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_MODE]: mode, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.byteLength } }),
    gzip(source, { level: 9 }),
  ]);
  const written = { source: source.byteLength, br: 0, gzip: 0 };
  if (br.byteLength < source.byteLength) { await fs.writeFile(file + '.br', br); written.br = br.byteLength; }
  if (gz.byteLength < source.byteLength) { await fs.writeFile(file + '.gz', gz); written.gzip = gz.byteLength; }
  return written.br || written.gzip ? written : null;
}

/**
 * Every file under `dir`: stale and orphaned siblings removed, fresh ones
 * written. Returns what it wrote, for the build's log and the image-size report.
 */
export async function precompressTree(dir) {
  const report = { files: 0, source: 0, br: 0, gzip: 0 };
  const sources = [];
  for await (const file of walk(dir)) {
    const suffix = SIBLINGS.find(s => file.endsWith(s));
    if (suffix) {
      // A sibling whose source is gone describes nothing.
      const source = file.slice(0, -suffix.length);
      if (!(await fs.stat(source).catch(() => null))?.isFile()) await fs.rm(file, { force: true });
      continue;
    }
    sources.push(file);
  }
  // Bounded concurrency: brotli 11 is CPU-heavy, and zlib's pool has four threads.
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < sources.length) {
      const written = await precompressFile(sources[next++]);
      if (!written) continue;
      report.files++; report.source += written.source; report.br += written.br; report.gzip += written.gzip;
    }
  }));
  return report;
}

/** One log line: what a tree's siblings cost on disk and save on the wire. */
export const describePrecompression = (label, r) =>
  `${label}: precompressed ${r.files} files, ${(r.source / 1024).toFixed(0)} KB → ${(r.br / 1024).toFixed(0)} KB br / ${(r.gzip / 1024).toFixed(0)} KB gzip`;
