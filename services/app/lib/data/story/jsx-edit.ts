/**
 * WYSIWYG AST write-back for format:'jsx' stories.
 *
 * The interpreter (lib/story-ui/interpreter) stamps every rendered element with its AST
 * path (`data-mx-ast`, dot-separated child indexes counting ALL JsxNodes). While editing,
 * a contenteditable text host's DOM is the user's working copy; on commit the edit comes
 * back here as `{ astPath, innerHtml }` and is written into the JSX SOURCE — never scraped
 * from the DOM wholesale:
 *
 *  1. parse the source (lib/jsx), locate the host element by its AST path;
 *  2. convert the edited innerHTML to JSX nodes with the HTML→JSX conversion below —
 *     entities decoded, tags lowercased, void tags self-closed — SANITIZING as it goes:
 *     anything `validateJsxSource` would reject (dangerous tags, `on*` handlers, denied
 *     attrs, dangerous URL schemes) is DROPPED, not saved — a paste is an injection path
 *     and gets no editor trust;
 *  3. nested elements still carrying `data-mx-ast` that map to a COMPONENT in the original
 *     AST (embeds — their DOM is render chrome, not source) are spliced back verbatim from
 *     the ORIGINAL tree; plain HTML carriers just lose the stamp (the edited DOM copy wins);
 *  4. replace the host's children and re-serialize the whole tree (serializeJsx).
 *
 * Pure module — no DOM APIs — so the write-back is unit-testable in the node project.
 */
import { syntaxErrorDetail } from '@/lib/jsx/syntax-error';
import {
  parseJsx, serializeJsx,
  type JsxNode, type JsxElement, type JsxAttribute, type JsonValue, type ValidationError,
} from '@/lib/jsx';
import { validateJsx, hasDangerousScheme, listHasDangerousScheme } from '@/lib/jsx/validate';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS } from '@/lib/story-ui/component-names';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { isEditableTextHost, resolveJsxNodeAtPath } from '@/lib/story-ui/host-classify';

/*
 * Classification lives in a leaf module (lib/story-ui/host-classify) so the
 * document's edit chunk can ask "is this a text host" without importing the
 * whole write-back path. Re-exported here because this is where every existing
 * caller already looks for it.
 */
export { isEditableTextHost, resolveJsxNodeAtPath };

/** The name this module's own write-back paths use. */
const resolveByPath = resolveJsxNodeAtPath;

interface JsxDomEdit {
  /** The edited host's `data-mx-ast` path (dot-separated indexes into the node tree). */
  astPath: string;
  /** The host's edited innerHTML (contenteditable output — rich inline HTML, possibly hostile). */
  innerHtml: string;
}

interface ApplyDomEditsResult {
  /** The updated JSX source (unchanged when nothing could be applied). */
  source: string;
  /** Failures + sanitizer drops. Edits still apply; offending nodes/attrs are simply gone. */
  errors: ValidationError[];
}

const AST_PATH_DOM_ATTR = 'data-mx-ast';

interface JsxFormatEdit {
  /** The target element's `data-mx-ast` path (dot-separated indexes into the node tree). */
  astPath: string;
  /** The element's full resolved class string; empty/whitespace removes the attribute. */
  className?: string;
  /** The element's full inline style STRING (CSS declaration list); empty removes the attribute. */
  style?: string;
}

/**
 * Set the `className` / `style` attributes of plain HTML elements at the given AST paths (the
 * typography toolbar's commit path). Each present field is written verbatim (empty string
 * removes the attribute); absent fields are left untouched. Components and unresolvable/stale
 * paths are skipped — their chrome is render output, and a hostile path must never corrupt a
 * story body. Returns `source` unchanged when nothing could be applied or the source doesn't
 * parse. Never throws.
 */
export function applyFormatEditsToJsx(source: string, edits: JsxFormatEdit[]): string {
  const parsed = parseJsx(source);
  if (!parsed.ok) return source;
  let applied = false;
  for (const edit of edits) {
    const node = resolveByPath(parsed.nodes, edit.astPath);
    if (!node || node.type !== 'element' || node.isComponent) continue;
    if (edit.className !== undefined) {
      setCanonicalClassAttr(node, edit.className.trim());
      applied = true;
    }
    if (edit.style !== undefined) {
      const value = edit.style.trim();
      setStaticJsxAttr(node, 'style', value === '' ? undefined : value);
      applied = true;
    }
  }
  return applied ? serializeJsx(parsed.nodes) : source;
}

/** A grid drag/resize commit: the full rect for the `<GridItem>` at `astPath`. */
export interface JsxLayoutEdit {
  astPath: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Set `x`/`y`/`w`/`h` on the `<GridItem>` elements at the given AST paths (the story grid's
 * drag/resize commit path). One parse, one serialize for the whole batch — vertical
 * compaction moves siblings, so a drag commits several items at once. Paths that don't
 * resolve, or resolve to anything other than a `<GridItem>` component, are skipped — a
 * stale/hostile path must never corrupt a story body. Returns `source` unchanged when
 * nothing could be applied or the source doesn't parse. Never throws.
 */
export function applyLayoutEditsToJsx(source: string, edits: JsxLayoutEdit[]): string {
  if (edits.length === 0) return source;
  const parsed = parseJsx(source);
  if (!parsed.ok) return source;
  let applied = false;
  for (const edit of edits) {
    const node = resolveByPath(parsed.nodes, edit.astPath);
    if (!node || node.type !== 'element' || !node.isComponent || node.tag !== 'GridItem') continue;
    setStaticJsxAttr(node, 'x', edit.x);
    setStaticJsxAttr(node, 'y', edit.y);
    setStaticJsxAttr(node, 'w', edit.w);
    setStaticJsxAttr(node, 'h', edit.h);
    applied = true;
  }
  return applied ? serializeJsx(parsed.nodes) : source;
}

/**
 * Set the element's class attribute under the CANONICAL `className` spelling, replacing a
 * legacy `class` attr (or an accidental class+className pair) in place — a format edit must
 * never leave two spellings of the same attribute behind. Empty value removes the attribute.
 */
function setCanonicalClassAttr(el: JsxElement, value: string): void {
  const isClassAttr = (a: JsxAttribute) => a.name === 'className' || a.name === 'class';
  const first = el.attributes.findIndex(isClassAttr);
  for (let i = el.attributes.length - 1; i >= 0; i--) {
    if (isClassAttr(el.attributes[i])) el.attributes.splice(i, 1);
  }
  if (value === '') return;
  const attr: JsxAttribute = { name: 'className', value: { static: true, json: value }, start: 0, end: 0 };
  el.attributes.splice(first === -1 ? el.attributes.length : first, 0, attr);
}

/**
 * A text host is an HTML element whose direct children include at least one non-whitespace
 * text node and whose component/embed descendants, if any, are ALL inline embeds
 * (TEXT_HOST_INLINE_EMBEDS — spliced back verbatim on commit, locked islands while editing).
 * Any other component in the subtree keeps the whole host locked (its chrome is render
 * output; an edit could not be written back). `<style>` is text-shaped but is CSS, not
 * prose — never editable. SVG elements are DRAWING, not prose: contenteditable inside an
 * `<svg>` subtree is undefined browser behavior, so the whole subset stays atomic.
 */
// ---------------------------------------------------------------------------
// AST path resolution (mirrors the interpreter's indexing: ALL JsxNodes count)
// ---------------------------------------------------------------------------

/**
 * Resolve the node at an interpreter AST path (`data-mx-ast`) — public for the click-to-select
 * layer, which must classify a clicked element (plain / component / text host) in the SOURCE
 * before treating it as a format target.
 */
// ---------------------------------------------------------------------------
// Attribute-level write-back (the question/number edit modals' commit path)
// ---------------------------------------------------------------------------

/**
 * Set / replace / remove a STATIC attribute on an element, in place. `json === undefined`
 * removes the attribute; any other value sets it (replacing an existing attr in position,
 * appending a new one at the end).
 */
export function setStaticJsxAttr(el: JsxElement, name: string, json: JsonValue | undefined): void {
  const idx = el.attributes.findIndex(a => a.name === name);
  if (json === undefined) {
    if (idx !== -1) el.attributes.splice(idx, 1);
    return;
  }
  const attr: JsxAttribute = { name, value: { static: true, json }, start: 0, end: 0 };
  if (idx !== -1) el.attributes[idx] = attr;
  else el.attributes.push(attr);
}

/**
 * Where an inserted image goes: the node the person is on (the toolbar's
 * selection, captured when the insert was asked for — its source path, and
 * its authored id when it has one, since the upload is async), and optionally
 * which side of it. A drop names a side (the gap it landed in); the toolbar
 * and a paste leave it to `placeImageInJsx`'s rule.
 */
export interface JsxInsertAnchor {
  path: string;
  nodeId?: string;
  side?: 'before' | 'after' | 'inside';
}

/** Parts of a line: an image never goes inside one — it goes below the block holding it. */
const INLINE_TAGS = immutableSet(['span', 'strong', 'b', 'em', 'i', 'a', 'code', 'br', 'small', 'sup', 'sub', 's', 'del', 'u', 'mark', 'kbd', 'abbr', 'time']);
/** A table and a list take no loose image among their parts: below the whole table or list. */
const WHOLE_PARTS = immutableSet(['thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'li']);
/** Things an image goes INSIDE, at the end of their contents. */
const CONTAINER_COMPONENTS = immutableSet(['Card', 'CardContent', 'CardHeader', 'CardFooter', 'GridItem', 'Slide']);
const CONTAINER_TAGS = immutableSet(['div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'figure', 'nav']);

interface Located { node: JsxElement; parts: number[] }

/** The element an anchor names — by id first (it survives moves), else by path. */
function locateAnchor(nodes: JsxNode[], anchor: { path: string; nodeId?: string }): Located | null {
  if (anchor.nodeId) {
    const found: Located[] = [];
    const visit = (list: JsxNode[], prefix: number[]) => list.forEach((n, i) => {
      if (n.type !== 'element') return;
      const id = n.attributes.find((a) => a.name === 'id');
      if (id?.value.static && id.value.json === anchor.nodeId) found.push({ node: n, parts: [...prefix, i] });
      visit(n.children, [...prefix, i]);
    });
    visit(nodes, []);
    return found.length === 1 ? found[0] : null;
  }
  const parts = anchor.path.split('.').map(Number);
  if (!anchor.path || parts.some((n) => !Number.isInteger(n) || n < 0)) return null;
  const node = resolveByPath(nodes, anchor.path);
  return node?.type === 'element' ? { node, parts } : null;
}

const elementAt = (nodes: JsxNode[], parts: number[]): JsxElement | null => {
  const node = parts.length ? resolveByPath(nodes, parts.join('.')) : null;
  return node?.type === 'element' ? node : null;
};

/**
 * Put an uploaded image (`<img src="ref:<id>" />`) where the person is:
 *  - a text block (or any inline part of one): directly below that block,
 *    in the same container — a caret mid-paragraph never splits it;
 *  - a container (a card, its content, a grid cell, a section, a div of
 *    blocks): inside it, at the end of its contents;
 *  - anything else — a chart, an image, a table, a list, a grid: directly
 *    below it (a list item or table cell counts as its whole list or table);
 *  - no anchor, or one the document no longer has: the end of the first
 *    top-level container (the only case that appends).
 * A drop's explicit side is honoured, except that a grid cell's gap is its
 * inside — an image is never a loose child of `<Grid>`.
 *
 * Returns the new source and the image's SOURCE path (so the editor can
 * select it), or `source` unchanged and a null path when it does not parse or
 * the id is malformed — a bad insert must never corrupt a body.
 */
export function placeImageInJsx(
  source: string, imageId: string, anchor?: JsxInsertAnchor | null, options: { nodeId?: string } = {},
): { source: string; path: string | null } {
  const unchanged = { source, path: null };
  if (!/^[A-Za-z0-9]{6,12}$/.test(imageId)) return unchanged;
  const parsed = parseJsx(source);
  if (!parsed.ok) return unchanged;
  const id = options.nodeId && NODE_ID_RE.test(options.nodeId) ? ` id="${options.nodeId}"` : '';
  const imgParsed = parseJsx(`<img src="ref:${imageId}" alt="" className="my-6 block w-full rounded-md"${id} />`);
  const img = imgParsed.ok ? imgParsed.nodes.find((n): n is JsxElement => n.type === 'element') : undefined;
  if (!img) return unchanged;
  const roots = parsed.nodes;

  let at = anchor ? locateAnchor(roots, anchor) : null;
  // Climb out of line parts and table/list parts to the block that holds them.
  while (at && (INLINE_TAGS.has(at.node.tag) || WHOLE_PARTS.has(at.node.tag)
    || elementAt(roots, at.parts.slice(0, -1))?.tag === 'li') && at.parts.length > 1) {
    const parts = at.parts.slice(0, -1);
    const parent = elementAt(roots, parts);
    at = parent ? { node: parent, parts } : null;
  }

  if (at) {
    const { node, parts } = at;
    const isContainer = node.isComponent
      ? CONTAINER_COMPONENTS.has(node.tag)
      : CONTAINER_TAGS.has(node.tag) && !isEditableTextHost(node);
    let side = anchor?.side ?? (isContainer ? 'inside' : 'after');
    if (node.tag === 'GridItem') side = 'inside';
    if (side === 'inside') {
      // A card's contents live in its (last) CardContent: that is its end.
      if (node.tag === 'Card') {
        const index = node.children.findLastIndex((c) => c.type === 'element' && c.tag === 'CardContent');
        if (index !== -1) {
          const content = node.children[index] as JsxElement;
          content.children.push(img);
          content.selfClosing = false;
          return { source: serializeJsx(roots), path: [...parts, index, content.children.length - 1].join('.') };
        }
      }
      node.children.push(img);
      node.selfClosing = false;
      return { source: serializeJsx(roots), path: [...parts, node.children.length - 1].join('.') };
    }
    const siblings = parts.length > 1 ? elementAt(roots, parts.slice(0, -1))?.children : roots;
    if (siblings) {
      const index = parts[parts.length - 1] + (side === 'after' ? 1 : 0);
      siblings.splice(index, 0, img);
      return { source: serializeJsx(roots), path: [...parts.slice(0, -1), index].join('.') };
    }
  }

  // A plain <img> with a ref: src is exactly what the publish path already
  // accepts, and it re-validates the whole body on save — so the structural
  // insert is all that is owed here.
  const containerIndex = roots.findIndex((n) => n.type === 'element' && !n.isComponent);
  const container = containerIndex === -1 ? null : (roots[containerIndex] as JsxElement);
  if (container) {
    container.children.push(img);
    container.selfClosing = false;
    return { source: serializeJsx(roots), path: `${containerIndex}.${container.children.length - 1}` };
  }
  roots.push(img);
  return { source: serializeJsx(roots), path: String(roots.length - 1) };
}

/** The server's node-id shape (lib/story/node-ids): a letter, then three letters or digits. */
const NODE_ID_RE = /^[A-Za-z][A-Za-z0-9]{3}$/;
const ID_FIRST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ID_REST = `${ID_FIRST}0123456789`;
/** One unbiased pick from `alphabet`: bytes past the last whole multiple of its length are rejected. */
const pick = (alphabet: string): string => {
  const limit = 256 - (256 % alphabet.length);
  for (;;) {
    const [byte] = globalThis.crypto.getRandomValues(new Uint8Array(1));
    if (byte < limit) return alphabet[byte % alphabet.length];
  }
};
const randomNodeId = (): string => [ID_FIRST, ID_REST, ID_REST, ID_REST].map(pick).join('');

/**
 * A node id for something the editor inserts, in the server's shape and not
 * one the document already uses. Minted HERE so the inserted node is whole in
 * the source the editor holds: an id the server added later arrives as a
 * change inside the span an undo removes, and the undo is refused. The server
 * keeps an explicit id and repairs a duplicate, so a clash costs only that.
 */
export function freshNodeId(source: string, mint: () => string = randomNodeId): string {
  const taken = new Set([...source.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]));
  for (let attempt = 0; attempt < 64; attempt++) {
    const candidate = mint();
    if (NODE_ID_RE.test(candidate) && !taken.has(candidate)) return candidate;
  }
  return randomNodeId();
}

/** `placeImageInJsx`'s source alone — the insert without the editor's follow-up selection. */
export function insertImageInJsx(source: string, imageId: string, anchor?: JsxInsertAnchor | null): string {
  return placeImageInJsx(source, imageId, anchor).source;
}

/** Capture the element at a source path as an insert anchor: its path, and its authored id when it has one. */
export function nodeTargetInJsx(source: string, path: string): { path: string; nodeId?: string } | null {
  const parsed = parseJsx(source);
  if (!parsed.ok) return null;
  const node = resolveByPath(parsed.nodes, path);
  if (!node || node.type !== 'element') return null;
  const id = node.attributes.find((a) => a.name === 'id');
  return id?.value.static && typeof id.value.json === 'string' && id.value.json ? { path, nodeId: id.value.json } : { path };
}

/**
 * Which `<img>` an image edit means: its SOURCE path when the edit was asked
 * for, and its authored id when it had one. The id wins — a replace waits on an
 * upload, and a node inserted above the image meanwhile moves its path.
 */
export interface JsxImageTarget {
  path: string;
  nodeId?: string;
}

/** The plain `<img>` a target names, or null when the target is stale or not an image. */
function resolveImageTarget(nodes: JsxNode[], target: JsxImageTarget): JsxElement | null {
  const isImage = (n: JsxNode | null | undefined): n is JsxElement =>
    !!n && n.type === 'element' && !n.isComponent && n.tag === 'img';
  if (target.nodeId) {
    const found: JsxElement[] = [];
    const visit = (list: JsxNode[]) => {
      for (const n of list) {
        if (n.type !== 'element') continue;
        const id = n.attributes.find((a) => a.name === 'id');
        if (id?.value.static && id.value.json === target.nodeId) found.push(n);
        visit(n.children);
      }
    };
    visit(nodes);
    return found.length === 1 && isImage(found[0]) ? found[0] : null;
  }
  const node = resolveByPath(nodes, target.path);
  return isImage(node) ? node : null;
}

/**
 * REPLACE the picture an `<img>` shows with an uploaded image (`ref:<id>`).
 *
 * Only `src` changes: the node keeps its id (what its comments are anchored
 * to), its place, its classes and its alt text, so the replacement is the same
 * image in every respect the author arranged. A `srcSet`/`sizes` pair is
 * dropped with the old src — left behind, the browser would keep drawing the
 * old picture from it. Returns `source` unchanged when it does not parse, the
 * id is malformed or the target no longer names a plain `<img>`.
 */
export function replaceImageSrcInJsx(source: string, target: JsxImageTarget, imageId: string): string {
  if (!/^[A-Za-z0-9]{6,12}$/.test(imageId)) return source;
  const parsed = parseJsx(source);
  if (!parsed.ok) return source;
  const img = resolveImageTarget(parsed.nodes, target);
  if (!img) return source;
  setStaticJsxAttr(img, 'src', `ref:${imageId}`);
  img.attributes = img.attributes.filter((a) => !['srcset', 'sizes'].includes(a.name.toLowerCase()));
  return serializeJsx(parsed.nodes);
}

/**
 * Set an `<img>`'s alt text. Blank removes the attribute, which is what "no
 * description" means in the source. Same refusals as the replace above.
 */
export function setImageAltInJsx(source: string, target: JsxImageTarget, alt: string): string {
  const parsed = parseJsx(source);
  if (!parsed.ok) return source;
  const img = resolveImageTarget(parsed.nodes, target);
  if (!img) return source;
  const value = alt.trim();
  setStaticJsxAttr(img, 'alt', value === '' ? undefined : value);
  return serializeJsx(parsed.nodes);
}

/**
 * Capture the image an edit means at the moment it is asked for: its source
 * path and, when it has one, its authored id. Null when the path does not name
 * a plain `<img>` — nothing is uploaded for a target that cannot be replaced.
 */
export function imageTargetInJsx(source: string, path: string): JsxImageTarget | null {
  const parsed = parseJsx(source);
  if (!parsed.ok) return null;
  const img = resolveImageTarget(parsed.nodes, { path });
  if (!img) return null;
  const id = img.attributes.find((a) => a.name === 'id');
  return id?.value.static && typeof id.value.json === 'string' && id.value.json ? { path, nodeId: id.value.json } : { path };
}

/** The alt text of the `<img>` a target names; null when it has none or is not an image. */
export function imageAltInJsx(source: string, target: JsxImageTarget): string | null {
  const parsed = parseJsx(source);
  if (!parsed.ok) return null;
  const alt = resolveImageTarget(parsed.nodes, target)?.attributes.find((a) => a.name === 'alt');
  return alt?.value.static && typeof alt.value.json === 'string' && alt.value.json.trim() !== '' ? alt.value.json : null;
}

/**
 * Remove the ELEMENT at `astPath` from a story body (the editor's delete affordance —
 * toolbar button, inspector button, Delete/Backspace on a selection). Splicing a node out
 * shifts every later sibling's AST path, so callers must treat the result as a NEW document
 * (adopt + remount) — exactly what the editor's queue-and-adopt path already does.
 *
 * Refused (source returned unchanged): unparseable source, unresolvable/malformed paths,
 * non-element nodes (selection only ever names elements — anything else is a stale or
 * hostile path), and removing the LAST top-level element — a delete must never empty the
 * document, because an empty body reads as data loss, not as an edit.
 */
export function removeJsxNodeAtPath(source: string, astPath: string): string {
  const parsed = parseJsx(source);
  if (!parsed.ok) return source;
  const parts = astPath.split('.').map(Number);
  if (parts.length === 0 || parts.some(n => !Number.isInteger(n) || n < 0)) return source;
  let list = parsed.nodes;
  for (const idx of parts.slice(0, -1)) {
    const node = list[idx];
    if (!node || node.type !== 'element') return source;
    list = node.children;
  }
  const idx = parts[parts.length - 1];
  const node = list[idx];
  if (!node || node.type !== 'element') return source;
  const lastRootElement = list === parsed.nodes
    && parsed.nodes.filter(n => n.type === 'element').length <= 1;
  if (lastRootElement) return source;
  list.splice(idx, 1);
  return serializeJsx(parsed.nodes);
}

/**
 * Attribute-level write-back for the story-embed edit modals: parse `source`, resolve the
 * element at `astPath` (the interpreter's `data-mx-ast` path), verify it is a `<tag>` component,
 * hand it to `mutate` for attribute edits, and re-serialize the whole tree. Returns `source`
 * UNCHANGED when the path doesn't resolve to a matching element, `mutate` returns false (its
 * own staleness guard), or the source doesn't parse — a stale/hostile path must never corrupt
 * a story body.
 */
export function updateJsxElementAtPath(
  source: string, astPath: string, tag: string, mutate: (el: JsxElement) => boolean | void,
): string {
  const parsed = parseJsx(source);
  if (!parsed.ok) return source;
  const node = resolveByPath(parsed.nodes, astPath);
  if (!node || node.type !== 'element' || !node.isComponent || node.tag !== tag) return source;
  if (mutate(node) === false) return source;
  return serializeJsx(parsed.nodes);
}

// ---------------------------------------------------------------------------
// HTML → JSX conversion (DOM-ish parser; pure, no document)
// ---------------------------------------------------------------------------

type TmpElement = { kind: 'el'; tag: string; attrs: { name: string; value: string | true }[]; children: TmpNode[] };
type TmpNode = TmpElement | { kind: 'text'; value: string };

const VOID_TAGS = immutableSet([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
/** Content parses as raw text (no nested tags) per the HTML spec's raw-text elements. */
const RAW_TEXT_TAGS = immutableSet(['script', 'style', 'textarea', 'title', 'xmp']);
/** Active-content tags: dropped WITH their entire subtree (mirrors lib/jsx/validate's denylist). */
const DROP_TAGS = immutableSet([
  'script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form',
  'frame', 'frameset', 'applet', 'noscript',
]);
/** Name-denied attrs (lowercase) — lib/jsx/validate DENIED_ATTRS. */
const DENIED_ATTRS = immutableSet(['dangerouslysetinnerhtml', 'ref', 'key', 'srcdoc', 'is']);
/**
 * Inline-style attrs (lowercase) — lib/jsx/validate INLINE_STYLE_ATTRS. The
 * publish door runs stylePolicy 'no-inline-style', and every paste from a
 * rich-text source (Google Docs, Word, any web page) arrives as spans carrying
 * style="…" — kept, they compose fine and then the SAVE is refused with an
 * error naming markup the user never typed. Laundered here like every other
 * attribute the door would reject.
 */
const INLINE_STYLE_ATTRS = immutableSet(['style', 'labelstyle']);
const URL_ATTRS = immutableSet(['href', 'src', 'action', 'formaction', 'poster', 'background', 'cite', 'data', 'xlink:href', 'ping']);
const URL_LIST_ATTRS = immutableSet(['srcset', 'ping']);
// Lowercased: the paste parser lowercases tags, while STORY_HTML_TAGS carries
// canonical (camelCase) SVG names.
const ALLOWED_HTML = immutableSet<string>(STORY_HTML_TAGS.map(t => t.toLowerCase()));

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Lenient HTML fragment parser: contenteditable output is mostly well-formed; garbage degrades to text. */
function parseHtmlFragment(html: string): TmpNode[] {
  const root: TmpElement = { kind: 'el', tag: '#root', attrs: [], children: [] };
  const stack: TmpElement[] = [root];
  const top = () => stack[stack.length - 1];
  const pushText = (raw: string) => { if (raw) top().children.push({ kind: 'text', value: decodeEntities(raw) }); };
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { pushText(html.slice(i)); break; }
    if (lt > i) pushText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { // doctype / processing instruction
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html[lt + 1] === '/') { // closing tag: pop to the matching open element (or ignore)
      const end = html.indexOf('>', lt);
      const tag = html.slice(lt + 2, end === -1 ? html.length : end).trim().toLowerCase();
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].tag === tag) { stack.length = s; break; }
      }
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt));
    if (!m) { pushText('<'); i = lt + 1; continue; } // stray '<' — literal text
    const tag = m[1].toLowerCase();
    let j = lt + m[0].length;
    const attrs: { name: string; value: string | true }[] = [];
    let selfClose = false;
    while (j < html.length) { // attributes until '>' / '/>'
      while (j < html.length && /\s/.test(html[j])) j++;
      if (html[j] === '>') { j++; break; }
      if (html[j] === '/') {
        if (html[j + 1] === '>') { selfClose = true; j += 2; break; }
        j++;
        continue;
      }
      const am = /^[^\s=/>]+/.exec(html.slice(j));
      if (!am) { j++; continue; }
      const name = am[0];
      j += am[0].length;
      while (j < html.length && /\s/.test(html[j])) j++;
      if (html[j] === '=') {
        j++;
        while (j < html.length && /\s/.test(html[j])) j++;
        let value = '';
        const q = html[j];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, j + 1);
          value = html.slice(j + 1, end === -1 ? html.length : end);
          j = end === -1 ? html.length : end + 1;
        } else {
          const vm = /^[^\s>]*/.exec(html.slice(j));
          value = vm ? vm[0] : '';
          j += value.length;
        }
        attrs.push({ name, value: decodeEntities(value) });
      } else {
        attrs.push({ name, value: true });
      }
    }
    const el: TmpElement = { kind: 'el', tag, attrs, children: [] };
    top().children.push(el);
    if (RAW_TEXT_TAGS.has(tag)) { // consume raw content up to the matching close tag
      const rest = html.slice(j);
      const cm = new RegExp(`</${tag}\\s*>`, 'i').exec(rest);
      const raw = cm ? rest.slice(0, cm.index) : rest;
      if (raw) el.children.push({ kind: 'text', value: raw });
      i = cm ? j + cm.index + cm[0].length : html.length;
      continue;
    }
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push(el);
    i = j;
  }
  return root.children;
}

// ---------------------------------------------------------------------------
// Sanitize + convert Tmp tree → JsxNodes (with original-AST splicing)
// ---------------------------------------------------------------------------

function sanitizeAttrs(el: TmpElement, errors: ValidationError[]): JsxAttribute[] {
  const out: JsxAttribute[] = [];
  for (const a of el.attrs) {
    const lower = a.name.toLowerCase();
    // Render/edit artifacts never belong in source. Matched by PREFIX, so every data-mx-*
    // the interpreter adds later (busy, selected, hover) is covered without editing this.
    if (lower.startsWith('data-mx-') || lower === 'contenteditable') continue;
    if (lower.startsWith('on') || DENIED_ATTRS.has(lower) || INLINE_STYLE_ATTRS.has(lower)) {
      errors.push({ message: `Dropped attribute "${a.name}" on pasted <${el.tag}>`, attr: a.name, tag: el.tag });
      continue;
    }
    if (typeof a.value === 'string') {
      const dangerous = URL_LIST_ATTRS.has(lower)
        ? listHasDangerousScheme(a.value, lower)
        : URL_ATTRS.has(lower) && hasDangerousScheme(a.value);
      if (dangerous) {
        errors.push({ message: `Dropped attribute "${a.name}" with a disallowed URL scheme on <${el.tag}>`, attr: a.name, tag: el.tag });
        continue;
      }
    }
    // Canonicalize: DOM innerHTML always serializes `class=`; the JSX source canon is className.
    const name = lower === 'class' ? 'className' : a.name;
    out.push({ name, value: { static: true, json: a.value }, start: 0, end: 0 });
  }
  return out;
}

function tmpToJsxNodes(tmp: TmpNode[], originalRoots: JsxNode[], errors: ValidationError[]): JsxNode[] {
  const out: JsxNode[] = [];
  for (const n of tmp) {
    if (n.kind === 'text') {
      out.push({ type: 'text', value: n.value, start: 0, end: 0 });
      continue;
    }
    // Elements still stamped with their AST path: a COMPONENT's DOM is render chrome — splice
    // the ORIGINAL AST child back verbatim. Plain HTML carriers just lose the stamp below.
    const astAttr = n.attrs.find(a => a.name.toLowerCase() === AST_PATH_DOM_ATTR);
    if (astAttr && typeof astAttr.value === 'string') {
      const original = resolveByPath(originalRoots, astAttr.value);
      if (original && original.type === 'element' && original.isComponent) {
        out.push(structuredClone(original));
        continue;
      }
    }
    if (DROP_TAGS.has(n.tag)) { // active content: dropped with its entire subtree
      errors.push({ message: `Dropped pasted <${n.tag}> element`, tag: n.tag });
      continue;
    }
    const children = tmpToJsxNodes(n.children, originalRoots, errors);
    if (!ALLOWED_HTML.has(n.tag)) { // not story markup, not dangerous: unwrap, keep the content
      errors.push({ message: `Unwrapped pasted <${n.tag}> element (not in the story tag allowlist)`, tag: n.tag });
      out.push(...children);
      continue;
    }
    out.push({
      type: 'element',
      tag: n.tag,
      isComponent: false,
      attributes: sanitizeAttrs(n, errors),
      children,
      selfClosing: children.length === 0,
      start: 0,
      end: 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The write-back
// ---------------------------------------------------------------------------

/**
 * Apply contenteditable DOM edits back onto a story's JSX source. Each edit REPLACES the
 * children of the element at `astPath` with the sanitized JSX conversion of `innerHtml`.
 * Never throws; unresolvable paths / residual validation failures skip that edit and are
 * reported in `errors` (sanitizer drops are reported too, but do not block the edit).
 */
export function applyDomEditsToJsx(source: string, edits: JsxDomEdit[]): ApplyDomEditsResult {
  const parsed = parseJsx(source);
  if (!parsed.ok) return { source, errors: [syntaxErrorDetail(source, parsed)] };
  const errors: ValidationError[] = [];

  // Resolve every host against the ORIGINAL tree before mutating anything — edits replace
  // children in place (indexes at and above host level never shift), so paths stay valid.
  const resolved = edits.map(edit => ({ edit, host: resolveByPath(parsed.nodes, edit.astPath) }));
  let applied = false;
  for (const { edit, host } of resolved) {
    if (!host || host.type !== 'element') {
      errors.push({ message: `No element at AST path "${edit.astPath}" — edit skipped` });
      continue;
    }
    const children = tmpToJsxNodes(parseHtmlFragment(edit.innerHtml), parsed.nodes, errors);
    // Belt-and-braces: the sanitizer must have produced nodes clean by the PUBLISH door's
    // rules (stylePolicy included — an edit that composes but cannot save is still a
    // refusal, just a later and more confusing one). If anything slipped through (a future
    // validator rule this module lags behind), refuse the edit.
    const residual = validateJsx(children, { components: JSX_STORY_COMPONENT_NAMES, allowedHtmlTags: STORY_HTML_TAGS, stylePolicy: 'no-inline-style' });
    if (residual.length > 0) {
      errors.push(...residual);
      continue;
    }
    host.children = children;
    if (children.length > 0) host.selfClosing = false;
    applied = true;
  }
  return { source: applied ? serializeJsx(parsed.nodes) : source, errors };
}
