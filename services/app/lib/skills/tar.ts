/**
 * A ustar + gzip archive of the rendered tree — `curl -s …/docs?download=true
 * | tar xz` hands an HTTP agent the plugin's `skills/` folder on disk in one
 * turn, so it can `grep -rl` across files and open the ONE that matched
 * (measured: deck's docs reads went 12 → 2 once the docs were a folder of
 * small files; a plugin agent never pages, it opens a matched file whole).
 *
 * Hand-rolled on purpose: ~40 lines, no dependency, and the format is fixed
 * (POSIX ustar, 512-byte blocks, octal fields, checksum over the header with
 * the checksum field as spaces).
 */
import { gzipSync } from 'node:zlib';

export interface ArchiveEntry {
  /** Path inside the archive, e.g. `skills/markup/SKILL.md`. */
  path: string;
  content: string;
}

const BLOCK = 512;

function header(name: string, size: number, type: '0' | '5'): Buffer {
  const h = Buffer.alloc(BLOCK, 0);
  h.write(name, 0, 100, 'utf8');
  h.write(type === '5' ? '0000755\0' : '0000644\0', 100, 8, 'ascii');
  h.write('0000000\0', 108, 8, 'ascii');
  h.write('0000000\0', 116, 8, 'ascii');
  h.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  h.write('00000000000\0', 136, 12, 'ascii'); // mtime 0: the archive is a function of the tree, byte-stable
  h.write('        ', 148, 8, 'ascii'); // checksum placeholder
  h.write(type, 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}

export function tarGz(entries: ArchiveEntry[]): Buffer {
  const parts: Buffer[] = [];
  const dirs = new Set<string>();
  for (const e of entries) {
    const segs = e.path.split('/');
    for (let i = 1; i < segs.length; i += 1) {
      const d = segs.slice(0, i).join('/') + '/';
      if (dirs.has(d)) continue;
      dirs.add(d);
      parts.push(header(d, 0, '5'));
    }
    const body = Buffer.from(e.content, 'utf8');
    parts.push(header(e.path, body.length, '0'), body);
    const pad = (BLOCK - (body.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  return gzipSync(Buffer.concat(parts));
}
