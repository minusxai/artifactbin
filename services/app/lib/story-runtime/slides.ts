/**
 * Slide discovery for the served document — pure, over the AST the island
 * already carries.
 *
 * The old rail discovered slides by POLLING the built iframe from the parent
 * document, because the engine painted asynchronously into a frame the parent
 * could reach into. Neither half of that is true any more: the document owns
 * its own chrome (same realm, no cross-origin reach), and the nodes are in
 * hand before the first paint. So discovery is a tree walk — the rail can be
 * SERVER-rendered at its final size, and the reservation dance that existed
 * only to stop a 190px layout shift (scripts/gate-layout-shift.mjs) is gone
 * with the guesswork that caused it.
 *
 * The title fallback matches the old `slide-nav.ts` rule: the authored
 * `title` prop, else the slide's first heading, else "Slide N".
 */
import type { JsxElement, JsxNode } from '@/lib/jsx';

/** A deck is two or more slides; one slide is a document with a header. */
export const MIN_SLIDES_FOR_RAIL = 2;

export interface DiscoveredSlide {
  /** Zero-based position in document order. */
  index: number;
  /** Rail/counter label (authored title ▸ first heading ▸ "Slide N"). */
  title: string;
  /**
   * The `<Slide>` ELEMENT, not its children: the slide's own classes are its
   * composition (a cover centres itself, a content slide does not), so a
   * preview built from the children alone shows every deck as top-left text
   * and tells the reader nothing about the slide they are about to jump to.
   */
  node: JsxElement;
  /**
   * Where this slide is in the tree (`data-mx-ast`), so an edit can name it.
   * Discovery already walks the nodes; carrying the path costs nothing and is
   * the only way a rename knows what it renamed.
   */
  path: string;
}

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const isElement = (n: JsxNode): n is JsxElement => n.type === 'element';

/** Flatten an element's text, in document order. */
function textOf(node: JsxNode): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'expression') return node.value.static && typeof node.value.json === 'string' ? node.value.json : '';
  return node.children.map(textOf).join('');
}

/** The slide's first heading text, if it has one. */
function firstHeading(nodes: JsxNode[]): string | null {
  for (const n of nodes) {
    if (!isElement(n)) continue;
    if (!n.isComponent && HEADINGS.has(n.tag.toLowerCase())) {
      const text = textOf(n).trim();
      if (text) return text;
    }
    const nested = firstHeading(n.children);
    if (nested) return nested;
  }
  return null;
}

function authoredTitle(el: JsxElement): string | null {
  const attr = el.attributes.find((a) => a.name === 'title');
  if (!attr?.value.static || typeof attr.value.json !== 'string') return null;
  const t = attr.value.json.trim();
  return t || null;
}

/** Every `<Slide>` in the tree, in document order. */
export function discoverSlides(nodes: JsxNode[]): DiscoveredSlide[] {
  const out: DiscoveredSlide[] = [];
  const walk = (list: JsxNode[], prefix: string): void => {
    list.forEach((n, i) => {
      const path = prefix ? `${prefix}.${i}` : String(i);
      if (!isElement(n)) return;
      if (n.isComponent && n.tag === 'Slide') {
        out.push({
          index: out.length,
          title: authoredTitle(n) ?? firstHeading(n.children) ?? `Slide ${out.length + 1}`,
          node: n,
          path,
        });
        // A slide inside a slide is not a thing; don't descend.
        return;
      }
      walk(n.children, path);
    });
  };
  walk(nodes, '');
  return out;
}

/** Whether the document should render the birds-eye rail at all. */
export function hasSlideRail(nodes: JsxNode[]): boolean {
  return discoverSlides(nodes).length >= MIN_SLIDES_FOR_RAIL;
}
