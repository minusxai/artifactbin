/**
 * The editing schema of a live region. Blocks are FLAT: a heading, list item or quoted paragraph is one `textblock`
 * whose structure lives in attributes (`level`, `list`, `depth`, `quote`), and nested `ul/ol/li/blockquote` exist
 * only in the saved HTML (html.ts builds and reads them). Flat blocks map one to one onto the lines of the region's
 * Y.Text (lines.ts): a block's attributes are its line's "\n" attributes, so a structural change is a format and
 * never recreates anything. Code blocks stay a separate type (no marks, preformatted text) over code lines.
 *
 * Every element of a stored page carries `data-af-id`. A block keeps the ids of the elements it stands for: its own
 * (`afId`), the `<li>` it opens (`itemId`), the `<ul>/<ol>` it opens (`listId`) and the `<blockquote>` it opens
 * (`quoteId`). Inline elements keep none (the saved page re-derives theirs by text carry-over; see the tests).
 */
import { Schema, type Node as PMNode, type NodeSpec, type MarkSpec, type DOMOutputSpec } from 'prosemirror-model';
import { safeHref } from './href';

export { safeHref };

export type RegionKind = 'rich' | 'text';
export const isRegionKind = (value: unknown): value is RegionKind => value === 'rich' || value === 'text';

/** Block attributes that hold an element identity (`data-af-id` of the element they stand for). */
export const ID_ATTRS = ['afId', 'itemId', 'listId', 'quoteId'] as const;
export type ListType = 'bullet' | 'ordered';
/** The deepest list nesting a region keeps. */
export const MAX_DEPTH = 6;

/** canonicalizeHtmlPage's own id grammar: anything else is dropped rather than allowed to fail a save. */
const NODE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
export const isNodeId = (value: unknown): value is string => typeof value === 'string' && NODE_ID.test(value);

const optionalId = { default: null, validate: (value: unknown) => { if (value !== null && !isNodeId(value)) throw new RangeError('invalid id'); } };
const structure = {
  list: { default: null, validate: (value: unknown) => { if (value !== null && value !== 'bullet' && value !== 'ordered') throw new RangeError('invalid list'); } },
  depth: { default: 0, validate: (value: unknown) => { if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_DEPTH) throw new RangeError('invalid depth'); } },
  quote: { default: false, validate: 'boolean' },
  afId: optionalId,
  itemId: optionalId,
  listId: optionalId,
  quoteId: optionalId,
};

/** Editing DOM only (the editor's view and in-editor copy); the saved HTML is html.ts's. */
const editingAttrs = (node: PMNode): Record<string, string> => {
  const out: Record<string, string> = {};
  if (node.attrs.afId) out['data-af-id'] = node.attrs.afId;
  if (node.attrs.list) { out['data-list'] = node.attrs.list; out['data-depth'] = String(node.attrs.depth); }
  if (node.attrs.quote) out['data-quote'] = '';
  if (node.attrs.list === 'bullet' && typeof node.attrs.checked === 'boolean') out['data-task'] = '';
  return out;
};

const richNodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },
  textblock: {
    group: 'block',
    content: 'inline*',
    attrs: { checked: { default: null, validate: (value: unknown) => { if (value !== null && typeof value !== "boolean") throw new RangeError("invalid checked"); } }, level: { default: 0, validate: (value: unknown) => { if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 6) throw new RangeError('invalid level'); } }, ...structure },
    parseDOM: [
      { tag: 'p', getAttrs: (el) => ({ level: 0, afId: idOf(el) }) },
      ...[1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, getAttrs: (el: HTMLElement) => ({ level, afId: idOf(el) }) })),
    ],
    toDOM: (node): DOMOutputSpec => [node.attrs.level ? `h${node.attrs.level}` : 'p', editingAttrs(node), 0],
  },
  code_block: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    attrs: structure,
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full', getAttrs: (el) => ({ afId: idOf(el) }) }],
    toDOM: (node): DOMOutputSpec => ['pre', editingAttrs(node), ['code', 0]],
  },
  rule: {
    group: 'block',
    attrs: { quote: structure.quote, afId: optionalId, quoteId: optionalId },
    parseDOM: [{ tag: 'hr', getAttrs: (el) => ({ afId: idOf(el) }) }],
    toDOM: (node): DOMOutputSpec => ['hr', editingAttrs(node)],
  },
  text: { group: 'inline' },
};

const idOf = (el: HTMLElement): string | null => { const id = el.getAttribute('data-af-id'); return isNodeId(id) ? id : null; };

/** Ranked outermost first: the saved HTML nests marks in this order. */
const richMarks: Record<string, MarkSpec> = {
  link: {
    attrs: { href: { validate: (value: unknown) => { if (safeHref(value) !== value) throw new RangeError('unsafe href'); } } },
    inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: (el) => { const href = safeHref(el.getAttribute('href')); return href ? { href } : false; } }],
    toDOM: (mark) => ['a', { href: mark.attrs.href }, 0],
  },
  strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
  em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
  code: { code: true, parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
};

const textNodes: Record<string, NodeSpec> = {
  doc: { content: 'textblock' },
  textblock: { content: 'text*', marks: '', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
  text: {},
};

const SCHEMAS: Record<RegionKind, Schema> = {
  rich: new Schema({ nodes: richNodes, marks: richMarks }),
  text: new Schema({ nodes: textNodes, marks: {} }),
};

/** The ProseMirror schema a region of this kind is edited in. One instance per kind. */
export function regionSchema(kind: RegionKind): Schema {
  return SCHEMAS[kind];
}
