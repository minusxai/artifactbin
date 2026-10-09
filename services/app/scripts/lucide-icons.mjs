/**
 * Lucide's icon path data, read from the pinned package's icon modules at BUILD time
 * (lib/story-ui/icon-glyphs.server reads the result from lib/build-assets at run time). The icon
 * packages are browser dependencies: the production server does not install them.
 *
 * Read from lucide-static, not lucide-react: this build script must not depend on a
 * framework package once neither reader ships React. lucide-static's `icon-nodes.json`
 * holds every CANONICAL icon's node data (1764, keyed by kebab name) but drops the
 * ~260 deprecated name ALIASES that lucide-react still ships as tiny re-export files
 * (an author's `<Icon name="activity-square">` must keep resolving); lucide-static's
 * `icons/*.svg` directory has one real, self-contained SVG file per name INCLUDING
 * those aliases, so an alias is identified by matching its parsed shape against a
 * canonical entry's node data, then resolved to that canonical entry exactly as
 * `readLucideIcons` used to follow lucide-react's alias chain.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/** The icon map's key for an author's spelling (kept equal to lib/story-ui/icon-contract iconGlyphKey). */
export const iconGlyphKey = (name) => String(name).split(/[-_\s]+/).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');

/** One SVG's flat child elements as `[tag, attrs]` pairs, the shape lucide's own node data uses. */
function parseSvgNodes(source) {
  const open = source.indexOf('<svg');
  const body = source.slice(source.indexOf('>', open) + 1, source.lastIndexOf('</svg>'));
  const tagRe = /<([a-zA-Z]+)((?:\s+[a-zA-Z0-9-]+="[^"]*")*)\s*\/>/g;
  const attrRe = /([a-zA-Z0-9-]+)="([^"]*)"/g;
  const nodes = [];
  for (let m = tagRe.exec(body); m; m = tagRe.exec(body)) {
    const attrs = {};
    attrRe.lastIndex = 0;
    for (let a = attrRe.exec(m[2]); a; a = attrRe.exec(m[2])) attrs[a[1]] = a[2];
    nodes.push([m[1], attrs]);
  }
  return nodes;
}

/** A shape signature for matching an alias SVG to its canonical entry, independent of attribute order. */
const signature = (nodes) => JSON.stringify(nodes.map(([tag, attrs]) => [tag, Object.fromEntries(Object.entries(attrs).sort())]));

/** Every lucide icon by key: its canonical file name and its path nodes. Aliases resolve to their target. */
export function readLucideIcons(root) {
  const require = createRequire(path.join(root, 'package.json'));
  const pkgDir = path.dirname(require.resolve('lucide-static/package.json'));
  const nodesByName = JSON.parse(fs.readFileSync(path.join(pkgDir, 'icon-nodes.json'), 'utf8'));
  const bySignature = new Map(Object.entries(nodesByName).map(([name, nodes]) => [signature(nodes), name]));

  const iconsDir = path.join(pkgDir, 'icons');
  const files = fs.readdirSync(iconsDir).filter((file) => file.endsWith('.svg'));
  const out = {};
  for (const file of files) {
    const kebab = file.slice(0, -4);
    if (kebab in nodesByName) { out[iconGlyphKey(kebab)] = { name: kebab, nodes: nodesByName[kebab] }; continue; }
    const nodes = parseSvgNodes(fs.readFileSync(path.join(iconsDir, file), 'utf8'));
    const canonical = bySignature.get(signature(nodes));
    if (!canonical) throw new Error(`Lucide alias '${kebab}' matches no canonical icon`);
    out[iconGlyphKey(kebab)] = { name: canonical, nodes: nodesByName[canonical] };
  }
  return out;
}
