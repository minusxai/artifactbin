/**
 * Outline discovery — the reading twin of slides.ts.
 *
 * A document's `<h2>`s are its sections and its `<h3>`s their parts. The
 * outline is a pure walk of the nodes the island already carries, for the
 * same reason slide discovery is: the rail can then be SERVER-rendered at its
 * final width and the first paint is the final geometry. Nothing polls, and
 * nothing is measured.
 *
 * When a document gets one is a judgement this module owns, so the runtime,
 * the SSR string and the tests all agree:
 *  - at least MIN_OUTLINE_SECTIONS `<h2>`s — two headings are a page, not a
 *    document, and a rail beside them is furniture;
 *  - not a DECK — the slide rail is a deck's navigation, and two rails is
 *    one too many;
 *  - not a DASHBOARD — a document laid out on `<Grid>` uses `<h2>` as tile
 *    titles, and its whole point is width, which a rail would take.
 * Headings inside a `<Slide>` never count: a deck that also carries prose
 * after its slides is still a deck.
 */
import type { JsxElement, JsxNode } from '@/lib/jsx';
import { hasSlideRail } from './slides';

/** Fewer sections than this is a page; a rail beside it would be furniture. */
export const MIN_OUTLINE_SECTIONS = 3;

export interface OutlineEntry {
  /** 2 for a section, 3 for a part of the section before it. */
  level: 2 | 3;
  title: string;
  /** Where the heading is in the tree (`data-mx-ast`) — how a click finds it. */
  path: string;
}

const isElement = (n: JsxNode): n is JsxElement => n.type === 'element';

/** Flatten an element's text, in document order. */
function textOf(node: JsxNode): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'expression') return node.value.static && typeof node.value.json === 'string' ? node.value.json : '';
  return node.children.map(textOf).join('');
}

/** Every h2/h3 outside a slide, in document order. */
export function discoverOutline(nodes: JsxNode[]): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const walk = (list: JsxNode[], prefix: string): void => {
    list.forEach((n, i) => {
      if (!isElement(n)) return;
      const path = prefix ? `${prefix}.${i}` : String(i);
      if (n.isComponent && n.tag === 'Slide') return;
      if (!n.isComponent) {
        const tag = n.tag.toLowerCase();
        if (tag === 'h2' || tag === 'h3') {
          const title = textOf(n).replace(/\s+/g, ' ').trim();
          if (title) out.push({ level: tag === 'h2' ? 2 : 3, title, path });
          return;
        }
      }
      walk(n.children, path);
    });
  };
  walk(nodes, '');
  return out;
}

/** Is any `<Grid>` in the tree — the dashboard's layout primitive. */
function usesGrid(nodes: JsxNode[]): boolean {
  for (const n of nodes) {
    if (!isElement(n)) continue;
    if (n.isComponent && n.tag === 'Grid') return true;
    if (usesGrid(n.children)) return true;
  }
  return false;
}

/** Does this document get a table of contents? See the module doc for the three rules. */
export function hasOutline(nodes: JsxNode[]): boolean {
  if (hasSlideRail(nodes) || usesGrid(nodes)) return false;
  return discoverOutline(nodes).filter((e) => e.level === 2).length >= MIN_OUTLINE_SECTIONS;
}
