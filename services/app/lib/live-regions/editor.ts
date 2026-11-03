/**
 * The editor side of a live region: the ProseMirror state a browser edits, bound to the region's Yjs fragment.
 * Sync and undo are y-prosemirror's; this adds the id dedupe filter, Markdown input rules, the flat-block commands
 * and a clipboard that reads and writes the region's own HTML (html.ts), so a paste passes the same sanitizer as
 * the server and a copy is the saved form, ids included (the dedupe drops repeats on paste).
 */
import { baseKeymap, chainCommands, joinBackward, newlineInCode, toggleMark } from 'prosemirror-commands';
import { InputRule, inputRules } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { DOMParser, DOMSerializer, Fragment, Slice, type Node as PMNode, type Schema } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { initProseMirrorDoc, redoCommand, undoCommand, ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import type * as Y from 'yjs';
import { readRegion, writeRegion, type SourceNode } from './html';
import { ID_ATTRS, MAX_DEPTH, regionSchema, safeHref, type ListType, type RegionKind } from './schema';

/** A browser DOM subtree as html.ts's element tree. */
function domSource(nodes: ArrayLike<Node>): SourceNode[] {
  const out: SourceNode[] = [];
  for (const node of Array.from(nodes)) {
    if (node.nodeType === 3) { out.push({ text: (node as Text).data }); continue; }
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    const tag = element.localName.toLowerCase();
    out.push({ tag, attr: (name) => element.getAttribute(name), children: tag === 'template' ? [] : domSource(element.childNodes) });
  }
  return out;
}

/** Pastes read through the region reader in strip mode, whatever their source. */
class RegionClipboardParser extends DOMParser {
  constructor(schema: Schema, private readonly kind: RegionKind) { super(schema, []); }
  override parse(dom: Node, options: { preserveWhitespace?: boolean | 'full' } = {}): PMNode {
    return readRegion(this.kind, domSource(dom.childNodes), 'strip', { preserveWhitespace: !!options.preserveWhitespace });
  }
  override parseSlice(dom: Node, options: { preserveWhitespace?: boolean | 'full' } = {}): Slice { return Slice.maxOpen(this.parse(dom, options).content); }
}

/** Copies write the region's normal form. */
class RegionClipboardSerializer extends DOMSerializer {
  constructor(private readonly schema: Schema, private readonly kind: RegionKind) { super(DOMSerializer.fromSchema(schema).nodes, DOMSerializer.fromSchema(schema).marks); }
  override serializeFragment(fragment: Fragment, options: { document?: Document } = {}, target?: HTMLElement | DocumentFragment): HTMLElement | DocumentFragment {
    let blocks = true;
    fragment.forEach((node) => { if (!node.isBlock) blocks = false; });
    if (!blocks) return super.serializeFragment(fragment, options, target);
    const doc = options.document ?? window.document;
    const template = doc.createElement('template');
    template.innerHTML = writeRegion(this.kind, this.schema.topNodeType.create(null, fragment));
    const out = target ?? doc.createDocumentFragment();
    out.append(...Array.from(template.content.childNodes));
    return out;
  }
}

/** A split, paste or join can copy a block's ids; the later copy loses each repeated one. */
const dedupeKey = new PluginKey('live-region-ids');
function idDedupe(): Plugin {
  return new Plugin({
    key: dedupeKey,
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const seen = new Set<string>();
      let tr: Transaction | null = null;
      state.doc.forEach((block, offset) => {
        let attrs: Record<string, unknown> | null = null;
        for (const name of ID_ATTRS) {
          const id = block.attrs[name];
          if (typeof id !== 'string') continue;
          if (seen.has(id)) (attrs ??= { ...block.attrs })[name] = null;
          else seen.add(id);
        }
        if (attrs) (tr ??= state.tr).setNodeMarkup(offset, undefined, attrs);
      });
      const changes = tr as Transaction | null;
      return changes ? changes.setMeta('addToHistory', false) : null;
    },
  });
}

/** The top-level block holding the selection head, or null outside a text block. */
function currentBlock(state: EditorState): { node: PMNode; pos: number } | null {
  const { $head } = state.selection;
  if ($head.depth !== 1 || !$head.parent.isTextblock) return null;
  return { node: $head.parent, pos: $head.before(1) };
}
const withAttrs = (state: EditorState, attrs: (node: PMNode) => Record<string, unknown> | null): Command => (_state, dispatch) => {
  const block = currentBlock(state);
  const next = block && attrs(block.node);
  if (!block || !next) return false;
  dispatch?.(state.tr.setNodeMarkup(block.pos, undefined, { ...block.node.attrs, ...next }));
  return true;
};
const bind = (make: (state: EditorState) => Command): Command => (state, dispatch, view) => make(state)(state, dispatch, view);

export interface RegionCommands {
  splitBlock: Command; backspace: Command; indent: Command; outdent: Command;
  heading(level: number): Command; list(type: ListType | null): Command; quote(on: boolean): Command; codeBlock(on: boolean): Command;
  strong: Command; em: Command; code: Command; link(href: string | null): Command;
  undo: Command; redo: Command;
}

/** The structural edits of a region's editor (the keymap and input rules use these). */
export function regionCommands(kind: RegionKind): RegionCommands {
  const schema = regionSchema(kind);
  const rich = kind === 'rich';
  const none: Command = () => false;
  const outdentAttrs = (node: PMNode) => (node.attrs.list ? (node.attrs.depth > 1 ? { depth: node.attrs.depth - 1 } : { list: null, depth: 0 }) : null);
  const outdent = rich ? bind((state) => withAttrs(state, outdentAttrs)) : none;
  /** Enter: at a block's start an empty block goes before it (the text keeps its ids); elsewhere the block splits,
   * the second part keeps the structure, a heading's tail becomes a paragraph, and the dedupe drops the copied ids.
   * Enter in an empty list item or quote leaves it. */
  const splitBlock: Command = rich ? (state, dispatch) => {
    const block = currentBlock(state);
    if (!block) return false;
    const { node, pos } = block;
    if (!node.content.size && (node.attrs.list || node.attrs.quote)) {
      dispatch?.(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...(node.attrs.list ? outdentAttrs(node) : { quote: false }) }));
      return true;
    }
    if (!dispatch) return true;
    const tr = state.tr.deleteSelection();
    const $at = tr.selection.$from;
    const empty = { ...node.attrs, level: 0, afId: null, itemId: null, listId: null, quoteId: null };
    if ($at.parentOffset === 0 && $at.parent.content.size) {
      tr.insert($at.before(1), schema.nodes.textblock!.create(empty));
    } else {
      const atEnd = $at.parentOffset === $at.parent.content.size;
      tr.split($at.pos, 1, [{ type: schema.nodes.textblock!, attrs: atEnd ? empty : { ...$at.parent.attrs, level: atEnd ? 0 : $at.parent.attrs.level } }]);
    }
    dispatch(tr.scrollIntoView());
    return true;
  } : (_state, dispatch) => { void dispatch; return true; };
  /** Backspace at a block's start lifts it out of its list or quote first, then joins. */
  const backspace: Command = rich ? (state, dispatch, view) => {
    const block = currentBlock(state);
    if (block && state.selection.empty && state.selection.$head.parentOffset === 0) {
      const { node } = block;
      if (node.attrs.list) return outdent(state, dispatch, view);
      if (node.attrs.quote) return withAttrs(state, () => ({ quote: false }))(state, dispatch, view);
      if (node.attrs.level) return withAttrs(state, () => ({ level: 0 }))(state, dispatch, view);
    }
    return joinBackward(state, dispatch, view);
  } : joinBackward;
  const indent: Command = rich ? bind((state) => withAttrs(state, (node) => {
    if (!node.attrs.list || node.attrs.depth >= MAX_DEPTH) return null;
    const { $head } = state.selection;
    const index = $head.index(0);
    const previous = index > 0 ? state.doc.child(index - 1) : null;
    return previous?.attrs.list && previous.attrs.depth >= node.attrs.depth ? { depth: node.attrs.depth + 1 } : null;
  })) : none;
  const heading = (level: number): Command => (rich ? bind((state) => withAttrs(state, (node) => (node.type.name === 'textblock' ? { level } : null))) : none);
  const list = (type: ListType | null): Command => (rich ? bind((state) => withAttrs(state, (node) => (type ? { list: type, depth: Math.max(1, node.attrs.depth) } : { list: null, depth: 0 }))) : none);
  const quote = (on: boolean): Command => (rich ? bind((state) => withAttrs(state, () => ({ quote: on }))) : none);
  /** Converting to or from a code block replaces the block (a new Yjs element): text typed in it at that moment by
   * someone else is lost. The tests pin this. */
  const codeBlock = (on: boolean): Command => (rich ? (state, dispatch) => {
    const block = currentBlock(state);
    const type = on ? schema.nodes.code_block! : schema.nodes.textblock!;
    if (!block || block.node.type === type) return false;
    const { level: _level, ...structure } = block.node.attrs;
    void _level;
    dispatch?.(state.tr.setBlockType(block.pos, block.pos + block.node.nodeSize, type, on ? structure : { ...structure, level: 0 }));
    return true;
  } : none);
  const mark = (name: string): Command => (rich ? toggleMark(schema.marks[name]!) : none);
  const link = (href: string | null): Command => (rich ? (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;
    const safe = href === null ? null : safeHref(href);
    if (href !== null && !safe) return false;
    const tr = state.tr.removeMark(from, to, schema.marks.link!);
    if (safe) tr.addMark(from, to, schema.marks.link!.create({ href: safe }));
    dispatch?.(tr);
    return true;
  } : none);
  return { splitBlock, backspace, indent, outdent, heading, list, quote, codeBlock, strong: mark('strong'), em: mark('em'), code: mark('code'), link, undo: undoCommand, redo: redoCommand };
}

/** Markdown typed at the start of a block: `# `..`###### `, `- `/`* `, `1. `, `> `, ```` ``` ````, `---`. */
function markdownRules(kind: RegionKind): Plugin {
  const schema = regionSchema(kind);
  const block = (match: RegExp, attrs: (match: RegExpMatchArray, node: PMNode) => Record<string, unknown> | null) =>
    new InputRule(match, (state, found, start, end) => {
      const $start = state.doc.resolve(start);
      if ($start.depth !== 1 || $start.parent.type !== schema.nodes.textblock) return null;
      const next = attrs(found, $start.parent);
      if (!next) return null;
      return state.tr.delete(start, end).setNodeMarkup($start.before(1), undefined, { ...$start.parent.attrs, ...next });
    });
  const rules = [
    block(/^(#{1,6})\s$/, (found) => ({ level: found[1]!.length })),
    block(/^\s*[-*]\s$/, (_found, node) => ({ list: 'bullet', depth: Math.max(1, node.attrs.depth) })),
    block(/^\d+\.\s$/, (_found, node) => ({ list: 'ordered', depth: Math.max(1, node.attrs.depth) })),
    block(/^\s*>\s$/, () => ({ quote: true })),
    new InputRule(/^```$/, (state, _found, start, end) => {
      const $start = state.doc.resolve(start);
      if ($start.depth !== 1 || $start.parent.type !== schema.nodes.textblock) return null;
      const { level: _level, ...structure } = $start.parent.attrs;
      void _level;
      const tr = state.tr.delete(start, end);
      return tr.setBlockType($start.before(1), $start.before(1) + 1, schema.nodes.code_block!, structure);
    }),
    new InputRule(/^---$/, (state, _found, start, end) => {
      const $start = state.doc.resolve(start);
      const node = $start.parent;
      if ($start.depth !== 1 || node.type !== schema.nodes.textblock || node.attrs.list || node.content.size !== end - start) return null;
      const from = $start.before(1);
      const tr = state.tr.replaceWith(from, from + node.nodeSize, [
        schema.nodes.rule!.create({ quote: node.attrs.quote, afId: node.attrs.afId, quoteId: node.attrs.quoteId }),
        schema.nodes.textblock!.create({ quote: node.attrs.quote }),
      ]);
      return tr.setSelection(TextSelection.create(tr.doc, from + 2));
    }),
  ];
  return inputRules({ rules: kind === 'rich' ? rules : [] });
}

const MARK_SHORTCUTS = [
  { match: /(?<!\*)\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, mark: 'strong', width: 2 },
  { match: /(?<![*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, mark: 'em', width: 1 },
  { match: /(?<!`)`([^`]+)`$/, mark: 'code', width: 1 },
];
/**
 * `**x**`, `*x*` and `` `x` `` typed: the closing delimiter, then the opening one, are deleted and the mark added, each
 * in its own transaction. y-prosemirror diffs a changed text as ONE replaced range, so deleting both delimiters in one
 * transaction would delete and re-insert everything between them, and a concurrent edit of that text would see it
 * duplicated. (An InputRule returns one transaction, so this is a plugin of its own.)
 */
function markShortcuts(kind: RegionKind): Plugin {
  const schema = regionSchema(kind);
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (kind !== 'rich' || from !== to || view.composing) return false;
        const $from = view.state.doc.resolve(from);
        if (!$from.parent.isTextblock || $from.parent.type.spec.code || $from.marks().some((mark) => mark.type.spec.code)) return false;
        const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 500), $from.parentOffset, null, '\ufffc') + text;
        for (const shortcut of MARK_SHORTCUTS) {
          const found = shortcut.match.exec(before);
          if (!found) continue;
          const type = schema.marks[shortcut.mark]!;
          const start = from - (found[0].length - text.length);
          if (shortcut.width > 1) view.dispatch(view.state.tr.delete(from - (shortcut.width - 1), from));
          view.dispatch(view.state.tr.delete(start, start + shortcut.width));
          view.dispatch(view.state.tr.addMark(start, start + found[1]!.length, type.create()).removeStoredMark(type));
          return true;
        }
        return false;
      },
    },
  });
}

/**
 * The editor plugins of a region bound to its fragment: y-prosemirror sync and undo (each person undoes only their
 * own edits), the id dedupe, Markdown input rules, the keymap and the region clipboard.
 */
export function editorPlugins(kind: RegionKind, fragment: Y.XmlFragment, mapping?: ReturnType<typeof initProseMirrorDoc>['mapping']): Plugin[] {
  const schema = regionSchema(kind);
  const commands = regionCommands(kind);
  return [
    ySyncPlugin(fragment, mapping ? { mapping } : {}),
    yUndoPlugin({ protectedNodes: new Set(['textblock']) }),
    idDedupe(),
    markShortcuts(kind),
    markdownRules(kind),
    keymap({
      Enter: chainCommands(newlineInCode, commands.splitBlock),
      Backspace: commands.backspace,
      Tab: commands.indent,
      'Shift-Tab': commands.outdent,
      'Mod-z': commands.undo,
      'Mod-y': commands.redo,
      'Shift-Mod-z': commands.redo,
      'Mod-b': commands.strong,
      'Mod-i': commands.em,
      'Mod-e': commands.code,
    }),
    keymap(baseKeymap),
    new Plugin({
      props: {
        clipboardParser: new RegionClipboardParser(schema, kind),
        clipboardSerializer: new RegionClipboardSerializer(schema, kind),
        // A copy from a region names its open depths; any wrapping context would bypass the sanitizer, so only
        // the context-free form a flat region writes is kept.
        transformPastedHTML: (html) => html.replace(/\sdata-pm-slice="([^"]*)"/g, (all, value: string) => (/^\d+ \d+ \[\]$/.test(value) ? all : '')),
      },
    }),
  ];
}

/** The editor state of a region: its document is read from the fragment (synchronously), never parsed by the client. */
export function editorState(kind: RegionKind, fragment: Y.XmlFragment): EditorState {
  const schema = regionSchema(kind);
  const initial = fragment.length ? initProseMirrorDoc(fragment, schema) : null;
  return EditorState.create({ schema, doc: initial?.doc ?? schema.topNodeType.createAndFill()!, plugins: editorPlugins(kind, fragment, initial?.mapping) });
}
