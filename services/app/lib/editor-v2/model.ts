/** Source/engine adapter. Only this module knows both static JSX and ProseMirror. */
import { Schema, Fragment, Slice, type Node as EditorNode, type Mark, type NodeSpec } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { Root } from 'mdast';
import { validateClipboardAst } from './clipboard-ast';
import { normalizeLinkHref } from '@/lib/data/story/link-edit';
import type { JsxNode, JsxElement, JsxAttribute } from '@/lib/jsx';

const metadata = {
  source: { default: null },
  tag: { default: 'p' },
  synthetic: { default: false },
};
const blockTags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre']);
const containerTags = new Set([
  'div',
  'section',
  'article',
  'blockquote',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'GridItem',
]);
const inlineTags = new Set(['strong', 'b', 'em', 'i', 's', 'del', 'code', 'span', 'a', 'u', 'small', 'sup', 'sub']);
/** Engine metadata contains authored attributes only, never parser offsets or child snapshots. */
function sourceMetadata(node: JsxElement): JsxElement {
  return {
    ...node,
    start: 0,
    end: 0,
    children: [],
    attributes: node.attributes.map((a) => ({ ...a, start: 0, end: 0 })),
  };
}
function domAttributes(node: EditorNode | Mark): Record<string, string> {
  const source = node.attrs.source as JsxElement | null;
  const attrs: Record<string, string> = {};
  for (const a of source?.attributes ?? []) {
    if (
      a.value.static &&
      typeof a.value.json === 'string' &&
      ['id', 'className', 'href', 'aria-label', 'data-annotation-anchor', 'data-design', 'dir', 'lang'].includes(a.name)
    ) {
      if (a.name === 'href' && !normalizeLinkHref(a.value.json)) continue;
      attrs[a.name === 'className' ? 'class' : a.name] = a.value.json;
    }
  }
  if (node.attrs.synthetic) attrs.style = 'margin:0';
  return attrs;
}
const paragraph: NodeSpec = {
  group: 'block',
  content: 'inline*',
  attrs: metadata,
  toDOM: (node) => [node.attrs.tag, domAttributes(node), 0],
  parseDOM: [...blockTags].map((tag) => ({ tag, getAttrs: () => ({ tag }) })),
};
export const editorSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph,
    container: {
      group: 'block',
      content: 'block+',
      attrs: { ...metadata, tag: { default: 'div' } },
      toDOM: (node) => [node.attrs.tag, domAttributes(node), 0],
      parseDOM: [...containerTags]
        .filter((t) => !['GridItem', 'ul', 'ol', 'li', 'td', 'th'].includes(t))
        .map((tag) => ({ tag, getAttrs: () => ({ tag }) })),
    },
    bullet_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { ...metadata, tag: { default: 'ul' } },
      toDOM: (node) => ['ul', domAttributes(node), 0],
      parseDOM: [{ tag: 'ul', getAttrs: () => ({ tag: 'ul' }) }],
    },
    ordered_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { ...metadata, tag: { default: 'ol' } },
      toDOM: (node) => ['ol', domAttributes(node), 0],
      parseDOM: [{ tag: 'ol', getAttrs: () => ({ tag: 'ol' }) }],
    },
    list_item: {
      group: 'block',
      content: 'block+',
      attrs: { ...metadata, tag: { default: 'li' } },
      toDOM: (node) => ['li', domAttributes(node), 0],
      parseDOM: [{ tag: 'li', getAttrs: () => ({ tag: 'li' }) }],
    },
    table_cell: {
      group: 'block',
      content: 'block+',
      isolating: true,
      attrs: { ...metadata, tag: { default: 'td' } },
      toDOM: (node) => [node.attrs.tag, domAttributes(node), 0],
      parseDOM: [
        { tag: 'td', getAttrs: () => ({ tag: 'td' }) },
        { tag: 'th', getAttrs: () => ({ tag: 'th' }) },
      ],
    },
    column: {
      group: 'block',
      content: 'block+',
      isolating: true,
      attrs: { ...metadata, tag: { default: 'GridItem' } },
      toDOM: (node) => ['div', domAttributes(node), 0],
    },
    text: { group: 'inline' },
    hard_break: {
      attrs: metadata,
      inline: true,
      group: 'inline',
      selectable: false,
      toDOM: () => ['br'],
      parseDOM: [{ tag: 'br' }],
    },
    horizontal_rule: {
      attrs: metadata,
      group: 'block',
      toDOM: () => ['hr'],
      parseDOM: [{ tag: 'hr' }],
    },
  },
  marks: {
    inline: {
      attrs: metadata,
      excludes: '',
      toDOM: (mark) => [mark.attrs.tag, domAttributes(mark), 0],
      parseDOM: [...inlineTags].map((tag) => ({
        tag,
        getAttrs: () => ({ tag }),
      })),
    },
  },
});

export function isProseTree(node: JsxNode): boolean {
  if (node.type === 'text') return true;
  if (node.type !== 'element' || node.control || node.isComponent) return false;
  if (
    !blockTags.has(node.tag) &&
    !containerTags.has(node.tag) &&
    !inlineTags.has(node.tag) &&
    !['br', 'hr'].includes(node.tag)
  )
    return false;
  // Table structure and grandfathered inline styles remain renderer-owned.
  // Cells expose their own text regions; a text command never absorbs a cell.
  if (node.attributes.some((a) => !a.value.static || a.name.toLowerCase() === 'style')) return false;
  return node.children.every(isProseTree);
}
function inline(nodes: JsxNode[], marks: Mark[] = []): EditorNode[] {
  return nodes.flatMap((n) => {
    if (n.type === 'text') return n.value ? [editorSchema.text(n.value, marks)] : [];
    if (n.type !== 'element') return [];
    if (n.tag === 'br') return [editorSchema.nodes.hard_break.create({ source: sourceMetadata(n) }, null, marks)];
    return inline(n.children, [
      ...marks,
      editorSchema.marks.inline.create({
        tag: n.tag,
        source: sourceMetadata(n),
      }),
    ]);
  });
}
function blocks(nodes: JsxNode[]): EditorNode[] {
  return nodes.flatMap((n) => {
    if (n.type === 'text') return n.value.trim() ? [editorSchema.nodes.paragraph.create(null, inline([n]))] : [];
    if (n.type !== 'element') return [];
    if (n.tag === 'hr')
      return [
        editorSchema.nodes.horizontal_rule.create({
          source: sourceMetadata(n),
        }),
      ];
    const attrs = { tag: n.tag, source: sourceMetadata(n) };
    if (blockTags.has(n.tag)) return [editorSchema.nodes.paragraph.create(attrs, inline(n.children))];
    const type =
      n.tag === 'GridItem'
        ? 'column'
        : n.tag === 'ul'
          ? 'bullet_list'
          : n.tag === 'ol'
            ? 'ordered_list'
            : n.tag === 'li'
              ? 'list_item'
              : ['td', 'th'].includes(n.tag)
                ? 'table_cell'
                : 'container';
    const children: EditorNode[] = [];
    let run: JsxNode[] = [];
    const flush = () => {
      if (run.some((c) => c.type !== 'text' || c.value.trim()))
        children.push(editorSchema.nodes.paragraph.create({ synthetic: true }, inline(run)));
      run = [];
    };
    for (const child of n.children) {
      if (child.type === 'text' || (child.type === 'element' && (inlineTags.has(child.tag) || child.tag === 'br')))
        run.push(child);
      else {
        flush();
        children.push(...blocks([child]));
      }
    }
    flush();
    return [editorSchema.nodes[type].create(attrs, children.length ? children : editorSchema.nodes.paragraph.create())];
  });
}
export function editorDocument(nodes: JsxNode[]): EditorNode {
  const children = blocks(nodes);
  return editorSchema.nodes.doc.create(null, children.length ? children : editorSchema.nodes.paragraph.create());
}
function element(tag: string, children: JsxNode[], original?: JsxElement | null): JsxElement {
  return {
    type: 'element',
    tag,
    isComponent: /^[A-Z]/.test(tag),
    attributes: original?.attributes ?? [],
    children,
    selfClosing: ['br', 'hr', 'img'].includes(tag),
    start: 0,
    end: 0,
  };
}
export function sourceNodes(doc: EditorNode): JsxNode[] {
  const result: JsxNode[] = [];
  doc.forEach((n) => {
    if (n.attrs.synthetic && doc.type.name !== 'doc') {
      result.push(...sourceNodes(n));
      return;
    }
    let source: JsxNode;
    if (n.isText) source = { type: 'text', value: n.text!, start: 0, end: 0 };
    else
      source = element(
        n.type.name === 'hard_break' ? 'br' : n.type.name === 'horizontal_rule' ? 'hr' : n.attrs.tag,
        sourceNodes(n),
        n.attrs.source,
      );
    // Merge adjacent runs carrying the same mark into one authored inline node.
    const wrap = (index: number, destination: JsxNode[]) => {
      if (index === n.marks.length) {
        destination.push(source);
        return;
      }
      const mark = n.marks[index];
      const last = destination.at(-1);
      const original = mark.attrs.source as JsxElement | null;
      if (last?.type === 'element' && last.tag === mark.attrs.tag && last.attributes === (original?.attributes ?? null))
        wrap(index + 1, last.children);
      else {
        const next = element(mark.attrs.tag, [], original);
        destination.push(next);
        wrap(index + 1, next.children);
      }
    };
    wrap(0, result);
  });
  return result;
}
/** Split commands copy attrs; an authored ID must remain on only the first survivor. */
export function normalizeIdentities(tr: Transaction, mintMissing = false): Transaction {
  if (!tr.docChanged) return tr;
  const seen = new Set<string>();
  const identify = (source: JsxElement | null, tag: string): JsxElement | null => {
    const id = source?.attributes.find((a) => a.name === 'id')?.value;
    const value = id?.static && typeof id.json === 'string' ? id.json : null;
    if (value && !seen.has(value)) {
      seen.add(value);
      return source;
    }
    if (!value && !mintMissing) return source;
    const original = source ?? element(tag, []);
    const attributes = original.attributes.filter((a) => !['id', 'data-annotation-anchor'].includes(a.name));
    if (mintMissing) {
      // Explicit IDs are supported by the source contract. A UUID avoids reuse
      // across deleted nodes, tabs and concurrent editors without a server trip.
      const fresh = `e${globalThis.crypto.randomUUID().replaceAll('-', '')}`;
      attributes.push(attr('id', fresh));
      seen.add(fresh);
    }
    return { ...original, attributes };
  };
  const marks = new Map<Mark, { mark: Mark; end: number }>();
  tr.doc.descendants((node, pos) => {
    if (!node.isText && !node.attrs.synthetic) {
      const tag = node.type.name === 'hard_break' ? 'br' : node.type.name === 'horizontal_rule' ? 'hr' : node.attrs.tag;
      const source = identify(node.attrs.source, tag);
      if (source !== node.attrs.source) tr.setNodeMarkup(pos, undefined, { ...node.attrs, source });
    }
    for (const mark of node.marks) {
      const previous = marks.get(mark);
      let next = previous?.end === pos ? previous.mark : undefined;
      if (!next) {
        const source = identify(mark.attrs.source, mark.attrs.tag);
        next = source === mark.attrs.source ? mark : mark.type.create({ ...mark.attrs, source });
      }
      marks.set(mark, { mark: next, end: pos + node.nodeSize });
      if (!next.eq(mark)) tr.removeMark(pos, pos + node.nodeSize, mark).addMark(pos, pos + node.nodeSize, next);
    }
  });
  return tr;
}

function attr(name: string, value: string): JsxAttribute {
  return { name, value: { static: true, json: value }, start: 0, end: 0 };
}
/** Dialect AST → source-shaped fragment; shared by both paste paths. */
export function pasteFragment(root: Root): Slice {
  validateClipboardAst(root);
  const convert = (n: {
    type: string;
    value?: string;
    children?: unknown[];
    depth?: number;
    ordered?: boolean | null;
    url?: string;
  }): JsxNode[] => {
    if (n.type === 'text') return [{ type: 'text', value: n.value ?? '', start: 0, end: 0 }];
    const children = (n.children ?? []).flatMap((c) => convert(c as typeof n));
    const tags: Record<string, string> = {
      paragraph: 'p',
      strong: 'strong',
      emphasis: 'em',
      delete: 'del',
      blockquote: 'blockquote',
      listItem: 'li',
      table: 'table',
      tableRow: 'tr',
      tableCell: 'td',
      break: 'br',
      thematicBreak: 'hr',
      link: 'a',
    };
    if (n.type === 'inlineCode' || n.type === 'code') {
      const code = element('code', [{ type: 'text', value: n.value ?? '', start: 0, end: 0 }]);
      return [n.type === 'code' ? element('pre', [code]) : code];
    }
    const tag = n.type === 'heading' ? `h${n.depth}` : n.type === 'list' ? (n.ordered ? 'ol' : 'ul') : tags[n.type];
    if (!tag) return [];
    const e = element(tag, children);
    if (n.type === 'link' && n.url) e.attributes = [attr('href', n.url)];
    return [e];
  };
  return Slice.maxOpen(Fragment.from(blocks(root.children.flatMap((n) => convert(n)))));
}
/** No geometrical redistribution: remove text per column, then insert at range start. */
export function replaceColumnText(state: EditorState, text: string): Transaction {
  const { from, to } = state.selection;
  const ranges: Array<{ from: number; to: number }> = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      const start = Math.max(from, pos + 1),
        end = Math.min(to, pos + 1 + node.content.size);
      if (end > start) ranges.push({ from: start, to: end });
      return false;
    }
  });
  const tr = state.tr;
  for (const r of ranges.reverse()) tr.delete(r.from, r.to);
  tr.insertText(text, from);
  return tr.setSelection(TextSelection.create(tr.doc, from + text.length));
}

/** Toggle one semantic mark without removing other marks of the generic source-backed type. */
export function toggleInline(state: EditorState, tag: 'strong' | 'em' | 'u'): Transaction {
  const { from, to, empty } = state.selection;
  const aliases = tag === 'strong' ? ['strong', 'b'] : tag === 'em' ? ['em', 'i'] : ['u'];
  const matches = (mark: Mark) => mark.type === editorSchema.marks.inline && aliases.includes(mark.attrs.tag);
  const tr = state.tr;
  if (empty) {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    return tr.setStoredMarks(
      marks.some(matches) ? marks.filter((m) => !matches(m)) : [...marks, editorSchema.marks.inline.create({ tag })],
    );
  }
  const found: Mark[] = [];
  state.doc.nodesBetween(from, to, (node) => {
    for (const mark of node.marks) if (matches(mark) && !found.some((m) => m.eq(mark))) found.push(mark);
  });
  if (found.length) for (const mark of found) tr.removeMark(from, to, mark);
  else tr.addMark(from, to, editorSchema.marks.inline.create({ tag }));
  return tr;
}

/** Selection-wide mark state, including mixed formatting. */
export function inlineStates(state: EditorState): Record<'strong' | 'em' | 'u', boolean | 'mixed'> {
  const samples: readonly Mark[][] = [];
  const all: readonly Mark[][] = samples;
  if (state.selection.empty) (all as Mark[][]).push([...(state.storedMarks ?? state.selection.$from.marks())]);
  else
    state.doc.nodesBetween(state.selection.from, state.selection.to, (n) => {
      if (n.isText) (all as Mark[][]).push([...n.marks]);
    });
  const aliases = { strong: ['strong', 'b'], em: ['em', 'i'], u: ['u'] };
  return Object.fromEntries(
    Object.entries(aliases).map(([tag, names]) => {
      const values = all.map((marks) => marks.some((m) => names.includes(m.attrs.tag)));
      return [tag, values.length > 0 && values.every(Boolean) ? true : values.some(Boolean) ? 'mixed' : false];
    }),
  ) as Record<'strong' | 'em' | 'u', boolean | 'mixed'>;
}
