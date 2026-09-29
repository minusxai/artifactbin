/**
 * Lucide's icon path data, read from the pinned package's icon modules at BUILD time
 * (lib/story/icon-glyphs reads the result from lib/build-assets at run time). The icon
 * packages are browser dependencies: the production server does not install them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/** The icon map's key for an author's spelling (kept equal to lib/story-ui/icon-contract iconGlyphKey). */
export const iconGlyphKey = (name) => String(name).split(/[-_\s]+/).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');

/** Every lucide icon by key: its canonical file name and its path nodes. Aliases resolve to their target. */
export function readLucideIcons(root) {
  const require = createRequire(path.join(root, 'package.json'));
  const iconDir = path.join(path.dirname(require.resolve('lucide-react')), '..', 'esm', 'icons');
  const files = fs.readdirSync(iconDir).filter((file) => file.endsWith('.mjs') && file !== 'index.mjs');
  const read = (start) => {
    let file = start;
    for (let depth = 0; depth < 4; depth++) {
      const source = fs.readFileSync(path.join(iconDir, file), 'utf8');
      const alias = /export \{ default \} from '\.\/(.+\.mjs)'/.exec(source);
      if (alias) { file = alias[1]; continue; }
      const data = /const __iconNode = (\[[\s\S]*?\]);\nconst /.exec(source)?.[1];
      if (!data) throw new Error(`Lucide icon data missing: ${file}`);
      return { name: file.slice(0, -4), nodes: JSON.parse(data.replace(/([,{]\s*)([A-Za-z][A-Za-z0-9]*):/g, '$1"$2":')) };
    }
    throw new Error(`Lucide icon alias cycle: ${start}`);
  };
  return Object.fromEntries(files.map((file) => [iconGlyphKey(file.slice(0, -4)), read(file)]));
}
