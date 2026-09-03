/**
 * THE SELECTION, DESCRIBED FROM ITS ANCHOR — the frame half of a comment's quote.
 *
 * A comment used to keep one node and nothing else: a selection that started
 * inside a `<strong>` and ran into its paragraph collapsed to the `<strong>`,
 * and the rest was lost in this realm before anything was sent. This module
 * keeps the words — as a HINT beside the durable anchor, never a second
 * identity.
 *
 * Three verbs, one coordinate system:
 *   `anchorFor`     — the BLOCK that contains the selection (the `<p>`, not the
 *                     `<strong>` inside it; the first covered block when the
 *                     selection crosses several).
 *   `describeRange` — the quote plus one part per text run, each addressed
 *                     relative to that anchor and indexed into its node's
 *                     CANONICAL text (`lib/story/annotation-range`).
 *   `resolveParts`  — the reverse on a later DOM: re-find each part's text,
 *                     nearest the stored index, and build a live Range for it.
 *
 * NO DOM SURGERY anywhere here: the ranges are painted with the CSS Custom
 * Highlight API, because injected spans would be read back as document content
 * by the editor's own write-back.
 */
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import {
  canonicalQuote, findNearest, formatRel, parseRel,
  type AnnotationRange, type AnnotationRangePart, type RelAddress,
} from '@/lib/story/annotation-range';

/**
 * The text-holding elements. A selection anchors on one of these and never on
 * an inline inside it — `<strong>`, `<em>`, `<a>`, `<code>` and friends are
 * where a selection commonly STARTS, and anchoring there is how the rest of
 * the sentence used to be thrown away.
 */
const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote',
  'td', 'th', 'figcaption', 'dd', 'dt', 'pre',
]);

/**
 * A block: one of the text-holding tags, or any stamped element whose parent is
 * not one of them (a `<div>` of its own, a layout cell). An element inside a
 * text-holding tag is inline by construction, whatever its tag.
 */
function isBlock(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (BLOCK_TAGS.has(tag)) return true;
  const parentTag = el.parentElement?.tagName.toLowerCase() ?? '';
  return el.hasAttribute(AST_PATH_ATTR) && !BLOCK_TAGS.has(parentTag);
}

/** The nearest addressable block at or above `node` — null when nothing above it is one. */
function blockAt(node: Node | null): Element | null {
  let el = node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement ?? null;
  for (; el; el = el.parentElement) {
    if (isBlock(el) && el.hasAttribute(AST_PATH_ATTR)) return el;
  }
  return null;
}

/** A clipped text run: the part of one Text node the selection actually covers. */
interface TextRun { node: Text; start: number; end: number }

/** Every text run the range covers, in document order, clipped to the range. */
function runsIn(range: Range): TextRun[] {
  const container = range.commonAncestorContainer;
  if (container.nodeType === Node.TEXT_NODE) {
    return [{ node: container as Text, start: range.startOffset, end: range.endOffset }];
  }
  const doc = container.ownerDocument;
  if (!doc) return [];
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const out: TextRun[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    // comparePoint answers -1 before / 0 inside / 1 after, about the point given.
    if (range.comparePoint(text, text.length) < 0 || range.comparePoint(text, 0) > 0) continue;
    const start = text === range.startContainer ? range.startOffset : 0;
    const end = text === range.endContainer ? range.endOffset : text.length;
    if (end > start) out.push({ node: text, start, end });
  }
  return out;
}

/**
 * The anchor: the FIRST block the selection actually covers. "Actually" is
 * load-bearing — a drag that ends at the end of a line leaves the Range ending
 * at offset 0 of the next block, and that block holds none of the selection.
 */
export function anchorFor(range: Range): Element | null {
  for (const run of runsIn(range)) {
    if (!run.node.data.slice(run.start, run.end).trim()) continue;
    const block = blockAt(run.node);
    if (block) return block;
  }
  return blockAt(range.startContainer);
}

/** Where one canonical character sits in the DOM. */
interface CanonPoint { node: Text; offset: number }

/**
 * An element's canonical text, with the DOM position of every character (plus
 * one end sentinel), so an index can travel both ways. The collapse rule is the
 * shared one: whitespace runs become one space, the ends are trimmed — and a
 * collapsed space keeps the position of the run's FIRST character, so a range
 * that starts on it really does include the whitespace.
 */
function canonicalOf(el: Element): { text: string; pos: CanonPoint[] } {
  const doc = el.ownerDocument;
  const pos: CanonPoint[] = [];
  let text = '';
  if (!doc) return { text, pos };
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let spaceAt: CanonPoint | null = null;
  let last: CanonPoint | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const raw = textNode.data;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (/\s/.test(ch)) {
        // Leading whitespace is trimmed away; trailing never emits, because a
        // pending space is only spent when a real character follows it.
        if (text.length > 0 && !spaceAt) spaceAt = { node: textNode, offset: i };
        continue;
      }
      if (spaceAt) {
        text += ' ';
        pos.push(spaceAt);
        spaceAt = null;
      }
      text += ch;
      pos.push({ node: textNode, offset: i });
      last = { node: textNode, offset: i + 1 };
    }
  }
  if (last) pos.push(last);
  return { text, pos };
}

/** Is the recorded point at or after the DOM boundary? The scan below is monotonic. */
function atOrAfter(point: CanonPoint, node: Node, offset: number): boolean {
  if (point.node === node) return point.offset >= offset;
  return (node.compareDocumentPosition(point.node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** A DOM boundary → its index in the element's canonical text. */
function indexOfBoundary(canon: { text: string; pos: CanonPoint[] }, node: Node, offset: number): number {
  for (let i = 0; i < canon.pos.length; i++) {
    if (atOrAfter(canon.pos[i], node, offset)) return Math.min(i, canon.text.length);
  }
  return canon.text.length;
}

/** The element children of a parent — `rel` counts ELEMENTS, never text nodes. */
const elementChildren = (el: Element): Element[] => Array.from(el.children);

/**
 * `rel` for a node, from the anchor: '' the anchor itself, element-child steps
 * inside it, or `+n` following element siblings then steps. Null when the node
 * is not addressable from this anchor (before it, or off in another subtree) —
 * such a part is dropped rather than described with a lie.
 */
function relFor(anchor: Element, target: Element): string | null {
  const stepsDownTo = (from: Element, to: Element): number[] | null => {
    const steps: number[] = [];
    for (let el: Element | null = to; el && el !== from; el = el.parentElement) {
      const parent = el.parentElement;
      if (!parent) return null;
      steps.unshift(elementChildren(parent).indexOf(el));
    }
    return steps;
  };
  if (target === anchor) return '';
  if (anchor.contains(target)) {
    const steps = stepsDownTo(anchor, target);
    return steps ? formatRel({ sibling: 0, steps }) : null;
  }
  const parent = anchor.parentElement;
  if (!parent) return null;
  // The target's own ancestor that is a SIBLING of the anchor — the block the
  // selection ran into.
  let sibling: Element | null = target;
  while (sibling && sibling.parentElement !== parent) sibling = sibling.parentElement;
  if (!sibling) return null;
  const children = elementChildren(parent);
  const distance = children.indexOf(sibling) - children.indexOf(anchor);
  if (distance <= 0) return null;
  const steps = stepsDownTo(sibling, target);
  return steps ? formatRel({ sibling: distance, steps }) : null;
}

/** Walk a parsed `rel` from the anchor to the element it names, or null. */
function resolveAddress(anchor: Element, address: RelAddress): Element | null {
  let el: Element | null = anchor;
  if (address.sibling > 0) {
    const parent = anchor.parentElement;
    if (!parent) return null;
    const children = elementChildren(parent);
    el = children[children.indexOf(anchor) + address.sibling] ?? null;
  }
  for (const step of address.steps) {
    if (!el) return null;
    el = elementChildren(el)[step] ?? null;
  }
  return el;
}

/**
 * The selection as stored data: the words, and one part per text run addressed
 * from the anchor. Parts are in document order and never overlap; runs in the
 * same block read on, and a new block adds ONE space — the quote reads the way
 * the person selected it.
 */
export function describeRange(range: Range, anchor: Element): { quote: string; range: AnnotationRange } {
  const parts: AnnotationRangePart[] = [];
  let quote = '';
  let previousBlock: Element | null = null;
  const runs = runsIn(range);
  for (let i = 0; i < runs.length;) {
    const parent = runs[i].node.parentElement;
    // Consecutive runs under the SAME element are one part; a nested inline
    // starts its own, which is exactly what the old collapse threw away.
    let j = i;
    while (j < runs.length && runs[j].node.parentElement === parent) j++;
    const group = runs.slice(i, j);
    i = j;
    if (!parent) continue;
    const rel = relFor(anchor, parent);
    if (rel === null) continue;
    const canon = canonicalOf(parent);
    const start = indexOfBoundary(canon, group[0].node, group[0].start);
    const end = indexOfBoundary(canon, group[group.length - 1].node, group[group.length - 1].end);
    const text = canon.text.slice(start, end);
    if (!text.trim()) continue;
    parts.push({ rel, start, end, text });
    const block = blockAt(parent) ?? parent;
    if (previousBlock && block !== previousBlock) quote += ' ';
    quote += text;
    previousBlock = block;
  }
  return { quote: canonicalQuote(quote), range: { v: 1, parts } };
}

/**
 * The parts, found again on the document as it is NOW: each one's TEXT is what
 * is looked for and the stored index is only a hint (nearest occurrence wins),
 * so a paragraph that gained a sentence above still highlights the words that
 * were commented on. A part whose words are gone is skipped; when none is
 * found the caller falls back to tinting the whole anchor.
 */
export function resolveParts(anchor: Element, parts: AnnotationRangePart[]): Range[] {
  const doc = anchor.ownerDocument;
  if (!doc) return [];
  const out: Range[] = [];
  for (const part of parts) {
    const address = parseRel(part.rel);
    if (!address) continue;
    const target = resolveAddress(anchor, address);
    if (!target) continue;
    const canon = canonicalOf(target);
    const at = findNearest(canon.text, part.text, part.start);
    if (at === -1) continue;
    const from = canon.pos[at];
    const to = canon.pos[at + part.text.length];
    if (!from || !to) continue;
    const range = doc.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    out.push(range);
  }
  return out;
}

/**
 * The LIVE text selection inside `element`, described from it — the editor's
 * door to the same capture the view-mode bubble makes from its own Range. Null
 * when nothing is selected there, which is the common case: this rides every
 * caret move, and a caret has selected nothing.
 */
export function captureSelection(win: Window, element: Element): { quote: string; range: AnnotationRange } | null {
  const selection = win.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!range.toString().trim()) return null;
  // Only this element's own selection: a Range that starts elsewhere is not
  // what the caller is describing, and addressing it from here would lie.
  if (element !== range.startContainer && !element.contains(range.startContainer)) return null;
  const described = describeRange(range, element);
  return described.range.parts.length > 0 ? described : null;
}
