/**
 * The attribute names that carry a URL, shared by both scheme gates.
 *
 * Story markup is checked twice: `validateJsx` at SAVE time and the story
 * interpreter at RENDER time. That is deliberate defence-in-depth — but it only
 * works if both gates guard the same surface, and while these lists were
 * maintained separately they drifted: save-time carried `'xlink:href'` and
 * render-time carried `'xlinkhref'`. Both gates lowercase the attribute name
 * before lookup, so each spelling ended up guarded by exactly one gate instead of
 * two, and `xlink:href` on an inline `<svg><a>` executes script.
 *
 * One constant, imported by both, makes that divergence impossible rather than
 * something a reviewer has to notice. Entries must be LOWERCASE — every lookup
 * is `attr.name.toLowerCase()` — and both spellings of an attribute belong here,
 * since authors may write either the SVG form (`xlink:href`) or React's
 * (`xlinkHref`).
 */
import { immutableSet } from '@/lib/utils/immutable-collections';

/** Attributes whose whole value is a single URL. */
export const URL_ATTRS = immutableSet([
  'href',
  'src',
  'action',
  'formaction',
  'poster',
  'background',
  'cite',
  'data',
  'xlink:href',
  'xlinkhref',
  'ping',
]);

/** Attributes whose value is a comma/space-separated LIST of URLs. */
export const URL_LIST_ATTRS = immutableSet(['srcset', 'ping']);

/**
 * SVG paint/reference attributes that accept `url(…)` values. A paint server
 * reference may only be LOCAL (`url(#id)`): an external target is a fetch fired
 * from a guest viewer's browser (exfiltration) and taints the serialized
 * capture — the same two reasons banned-css bans external `url()` in authored
 * CSS. Lowercase + both spellings, same contract as URL_ATTRS above.
 */
export const SVG_PAINT_ATTRS = immutableSet([
  'fill',
  'stroke',
  'filter',
  'mask',
  'clip-path',
  'clippath',
  'marker-start',
  'markerstart',
  'marker-mid',
  'markermid',
  'marker-end',
  'markerend',
]);

const PAINT_URL_RE = /url\(\s*["']?\s*([^"')\s]*)/gi;

/** True when a paint value carries a url() whose target is not a local #fragment. */
export function paintHasExternalUrl(value: string): boolean {
  for (const m of value.matchAll(PAINT_URL_RE)) {
    if (!m[1].startsWith('#')) return true;
  }
  return false;
}
