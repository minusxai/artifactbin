/**
 * THE QUERY IMAGE'S FONTS. librsvg finds faces through fontconfig, and an app image may carry no
 * system fonts at all (its text then draws as empty boxes); the platform's own font files are
 * woff2, which this sharp build cannot read. So the drawing thread (./chart-image-worker.ts)
 * registers a few faces from the app's runtime @fontsource dependencies before its first job:
 * their WOFF 1.0 files rewritten as plain sfnt (each table inflated with node:zlib) into a
 * per-process temporary directory, each added to the process's fontconfig set by a one-character
 * sharp text render with `fontfile`. The image's font lists (./chart-draw.server.ts) name these
 * families after a page's own body family and before any system one.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';

/** The registered family for each generic family. */
export const IMAGE_FONTS = { sans: 'Barlow', mono: 'IBM Plex Mono', serif: 'Old Standard TT' } as const;
const FACES = [['barlow', IMAGE_FONTS.sans], ['ibm-plex-mono', IMAGE_FONTS.mono], ['old-standard-tt', IMAGE_FONTS.serif]] as const;

/** A WOFF 1.0 file as the sfnt (TrueType or CFF) font it wraps. */
export function woffToSfnt(woff: Buffer): Buffer {
  if (woff.readUInt32BE(0) !== 0x774f4646) throw new Error('not a WOFF 1.0 file');
  const count = woff.readUInt16BE(12);
  const tables = Array.from({ length: count }, (_, i) => {
    const at = 44 + i * 20, offset = woff.readUInt32BE(at + 4), stored = woff.readUInt32BE(at + 8), length = woff.readUInt32BE(at + 12);
    const raw = woff.subarray(offset, offset + stored);
    return { tag: woff.readUInt32BE(at), checksum: woff.readUInt32BE(at + 16), data: stored < length ? inflateSync(raw) : raw };
  });
  const header = 12 + 16 * count, padded = (n: number) => (n + 3) & ~3;
  const out = Buffer.alloc(tables.reduce((size, t) => size + padded(t.data.length), header));
  const selector = Math.floor(Math.log2(count)), range = 16 * 2 ** selector;
  out.writeUInt32BE(woff.readUInt32BE(4), 0);
  out.writeUInt16BE(count, 4); out.writeUInt16BE(range, 6); out.writeUInt16BE(selector, 8); out.writeUInt16BE(count * 16 - range, 10);
  let offset = header;
  tables.forEach((t, i) => {
    const record = 12 + 16 * i;
    out.writeUInt32BE(t.tag, record); out.writeUInt32BE(t.checksum, record + 4);
    out.writeUInt32BE(offset, record + 8); out.writeUInt32BE(t.data.length, record + 12);
    t.data.copy(out, offset);
    offset += padded(t.data.length);
  });
  return out;
}

/** Register the faces with fontconfig; the count registered (a missing package or face is skipped). */
export async function registerImageFonts(): Promise<number> {
  const require = createRequire(import.meta.url);
  // One directory per process, reused by a replacement thread, only while it is this user's own and private.
  let dir = path.join(tmpdir(), `artifactbin-chart-fonts-${process.pid}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const held = lstatSync(dir);
  if (!held.isDirectory() || (process.getuid && held.uid !== process.getuid()) || (held.mode & 0o077)) {
    dir = mkdtempSync(path.join(tmpdir(), 'artifactbin-chart-fonts-'));
  }
  let registered = 0;
  for (const [pkg, family] of FACES) for (const file of ['latin-400', 'latin-700', 'latin-ext-400', 'latin-ext-700']) {
    try {
      const target = path.join(dir, `${pkg}-${file}.ttf`);
      if (!existsSync(target)) {
        const source = path.join(path.dirname(require.resolve(`@fontsource/${pkg}`)), 'files', `${pkg}-${file}-normal.woff`);
        const partial = `${target}.${process.hrtime.bigint()}`;
        writeFileSync(partial, woffToSfnt(readFileSync(source)), { mode: 0o600 });
        renameSync(partial, target);
      }
      await sharp({ text: { text: 'x', font: family, fontfile: target } }).png().toBuffer();
      registered++;
    } catch { /* drawn in a system family instead */ }
  }
  return registered;
}
