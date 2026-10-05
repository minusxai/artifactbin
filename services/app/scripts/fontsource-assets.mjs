/** Shared fontsource descriptors and content-addressed URLs for shell, documents and design previews. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const packageDir = pkg => path.dirname(require.resolve(`${pkg}/package.json`));
/** The descriptors of each @font-face a package stylesheet declares, with its woff2 file. */
export function packageFaces(pkg, css) {
  const text = readFileSync(path.join(packageDir(pkg), css), 'utf8');
  return (text.match(/@font-face\s*\{[^}]*\}/g) ?? []).map((block) => {
    const get = (name) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim();
    const src = block.match(/url\(\.\/files\/([\w.-]+\.woff2)\)\s*format\('([\w-]+)'\)/);
    if (!src) throw new Error(`no woff2 source in ${pkg}/${css}: ${block}`);
    return {
      family: get('font-family').replace(/^'|'$/g, ''), style: get('font-style'), weight: get('font-weight'),
      display: get('font-display'), ...(get('font-stretch') ? { stretch: get('font-stretch') } : {}), unicodeRange: get('unicode-range'), file: src[1], format: src[2],
    };
  });
}

export function fontAsset(pkg, file) {
  const bytes = readFileSync(path.join(packageDir(pkg), 'files', file));
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const name = `${file.replace(/\.woff2$/, '')}.${hash}.woff2`;
  return { bytes, name, url: `/fonts/${name}` };
}
