/** Pinned font sources. Only the explicit design-systems `fonts` maintenance mode downloads;
 * install/build copy verified vendored bytes, using the existing /fonts asset pipeline. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceFaces = () => Object.values(JSON.parse(readFileSync(path.join(ROOT, 'fonts.json'), 'utf8'))).flat();

/** Verify every cached source and its family's upstream license before touching generated assets. */
export function designFontAssets(directory = path.join(ROOT, 'font-assets'), faces = sourceFaces()) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'sources.json'), 'utf8'));
  const verified = record => {
    if (!record || path.basename(record.file) !== record.file) throw new Error('Missing pinned design font or license; run generate:design-systems -- fonts');
    const bytes = readFileSync(path.join(directory, record.file));
    if (hash(bytes) !== record.sha256) throw new Error(`Design font checksum mismatch: ${record.file}`);
    return bytes;
  };
  const licenses = [...new Set(faces.map(face => face.family))].map(family => {
    const record = manifest.licenses[family], bytes = verified(record);
    if (!bytes.toString().includes('SIL OPEN FONT LICENSE')) throw new Error(`Invalid design font license: ${family}`);
    return { family, ...record, bytes };
  });
  const assets = [...new Set(faces.map(face => face.src))].map(source => {
    const record = manifest.fonts[source], bytes = verified(record);
    if (bytes.subarray(0, 4).toString() !== 'wOF2') throw new Error(`Invalid design font WOFF2: ${source}`);
    return { source, ...record, bytes };
  });
  return { assets, licenses };
}

/** Explicit maintainer update: retain source URLs, original bytes, checksums and actual upstream licenses. */
export async function updateDesignFontAssets() {
  const faces = sourceFaces(), directory = path.join(ROOT, 'font-assets');
  mkdirSync(directory, { recursive: true });
  const download = async source => {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Design font download ${response.status}: ${source}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const fonts = {}, licenses = {};
  for (const source of [...new Set(faces.map(face => face.src))].sort()) {
    const file = `${hash(source)}.woff2`, family = faces.find(face => face.src === source).family;
    const bytes = await download(source);
    if (bytes.subarray(0, 4).toString() !== 'wOF2') throw new Error(`Invalid design font WOFF2: ${source}`);
    fonts[source] = { file, sha256: hash(bytes), family };
    writeFileSync(path.join(directory, file), bytes);
  }
  for (const family of [...new Set(faces.map(face => face.family))].sort()) {
    const slug = family.toLowerCase().replace(/\s+/g, '');
    const source = `https://raw.githubusercontent.com/google/fonts/main/ofl/${slug}/OFL.txt`, file = `${slug}.OFL.txt`;
    const bytes = await download(source);
    if (!bytes.toString().includes('SIL OPEN FONT LICENSE')) throw new Error(`Invalid design font license: ${family}`);
    licenses[family] = { source, file, sha256: hash(bytes) };
    writeFileSync(path.join(directory, file), bytes);
  }
  writeFileSync(path.join(directory, 'sources.json'), JSON.stringify({ fonts, licenses }, null, 2) + '\n');
  designFontAssets();
}
