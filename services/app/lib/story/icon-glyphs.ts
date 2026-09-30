/**
 * Resolving a document's `<Icon>` glyphs — the SERVER half of the icon kit.
 *
 * `<Icon name>` may name any of lucide's ~1600 glyphs, so importing the whole map
 * into the kit costs 517 KB raw / 148 KB gz, in the entry every document downloads,
 * to serve the 2-in-155 that draw an icon — and paid on EVERY visit, because the
 * served document runs at an opaque origin and cannot reuse its cache across
 * navigations.
 *
 * So the set is resolved HERE, where its weight is free, down to the handful of
 * glyphs a document actually uses; those travel in the island beside `refData` and
 * the client renders them from data (components/kit/icon).
 *
 * Lucide's path data is extracted at build time (scripts/lucide-icons.mjs, written by
 * scripts/build-server-reader.mjs to lib/build-assets/lucide-icons.json): the icon
 * packages are browser dependencies and the production server does not install them.
 * Read lazily, on the first document that draws an icon. Guarded by
 * lib/story/__tests__/icon-glyphs.test.tsx. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { JsxNode } from '@/lib/jsx';
import { iconGlyphKey, FALLBACK_ICON_KEY, type GlyphMap, type IconGlyph } from '@/lib/story-ui/icon-contract';
import { FILE_GLYPH_NAMES } from '@/lib/story-ui/file-glyphs';

type LucideIcon = { name: string; nodes: Array<[string, Record<string, string>]> };
let icons: Record<string, LucideIcon> | null = null;
const lucideIcons = (): Record<string, LucideIcon> =>
  (icons ??= JSON.parse(readFileSync(path.join(process.cwd(), 'lib/build-assets/lucide-icons.json'), 'utf8')) as Record<string, LucideIcon>);
const escapeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Is this spelling one of lucide's glyphs (aliases included) — the publish-time icon check. */
export function isLucideIcon(name: string): boolean {
  return Object.hasOwn(lucideIcons(), iconGlyphKey(name));
}

function sourceFor(key: string): LucideIcon {
  const all = lucideIcons();
  return all[key] ?? all[FALLBACK_ICON_KEY]!;
}

/**
 * Render one lucide glyph and split it into the parts the client re-assembles.
 * Unknown names resolve to the fallback glyph — and take ITS class, exactly as
 * rendering the fallback COMPONENT would.
 */
const resolved = new Map<string, IconGlyph>();

function resolveGlyph(name: string): IconGlyph {
  const key = iconGlyphKey(name);
  const hit = resolved.get(key);
  // A glyph never changes, so resolving one twice is pure waste. Grows to at most the number
  // of DISTINCT icons this process has served, never freed — the icon set is the
  // only ceiling, and it is a fixed ~1600 entries of small strings.
  if (hit) return hit;
  const { name: resolvedName, nodes } = sourceFor(key);
  const canonical = resolvedName.replace(/-(?=\d)/g, '');
  const cls = [`lucide-${canonical}`, ...(canonical === resolvedName ? [] : [`lucide-${resolvedName}`])].join(' ');
  const inner = nodes.map(([tag, attrs]) => `<${tag}${Object.entries(attrs).filter(([attr]) => attr !== 'key').map(([attr, value]) => ` ${attr}="${escapeAttribute(value)}"`).join('')}></${tag}>`).join('');
  const glyph: IconGlyph = { cls, inner };
  resolved.set(key, glyph);
  return glyph;
}

/** Resolve exactly these names — the map is the size of the document's usage. */
export function buildGlyphMap(names: Iterable<string>): GlyphMap {
  const out: GlyphMap = {};
  for (const name of names) {
    const key = iconGlyphKey(name);
    if (!(key in out)) out[key] = resolveGlyph(name);
  }
  return out;
}

/**
 * Every icon a document draws, in the author's own spelling, deduped — plus
 * whether it draws one AT ALL, which is not the same question:
 * `<Icon />` and `<Icon name="" />` name nothing, and the contract is that a bad
 * name shows the question mark rather than a silent hole. (A non-static
 * `name={x}` never gets this far — validateJsx refuses it at publish: "Attribute
 * name must be a JSON literal, got Identifier".)
 */
export function scanIcons(nodes: JsxNode[]): { names: string[]; any: boolean } {
  const found = new Set<string>();
  let any = false;
  const visit = (node: JsxNode): void => {
    if (node.type !== 'element') return;
    if (node.tag === 'Icon') {
      any = true;
      const attr = node.attributes.find((a) => a.name === 'name');
      const value = attr?.value.static ? attr.value.json : null;
      if (typeof value === 'string' && value) found.add(value);
    }
    /*
     * A `<Files>` LISTING draws an icon per row and names none of them: the
     * glyph follows each row's FORMAT, chosen inside the component from rows
     * that do not exist until the query answers. So the component's whole
     * vocabulary is resolved for it (lib/story-ui/file-glyphs, the list both
     * halves read) — which is what a folder needs, since its entire document is
     * this one component and it would otherwise ship no glyphs at all.
     */
    if (node.tag === 'Files') {
      any = true;
      for (const name of FILE_GLYPH_NAMES) found.add(name);
    }
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return { names: [...found], any };
}


/**
 * The glyphs one document needs, resolved. Empty when it draws no icons; otherwise
 * always carries the fallback, so a name that resolves to nothing still draws.
 */
export function glyphsForNodes(nodes: JsxNode[]): GlyphMap {
  const { names, any } = scanIcons(nodes);
  if (!any) return {};
  return buildGlyphMap([...names, FALLBACK_ICON_KEY]);
}
