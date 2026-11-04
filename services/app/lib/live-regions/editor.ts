/**
 * The editor side of a live region: the ProseMirror state a browser edits, bound to the region's Y.Text by
 * binding.ts (sync and per-person undo). This adds the id dedupe filter, Markdown input rules, the flat-block commands
 * and a clipboard that reads and writes the region's own HTML (html.ts), so a paste passes the same sanitizer as
 * the server and a copy is the saved form, ids included (the dedupe drops repeats on paste).
 */
import { baseKeymap, chainCommands, joinBackward, newlineInCode, toggleMark } from 'prosemirror-commands';
import { InputRule, inputRules } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { DOMParser, DOMSerializer, Fragment, Slice, type Node as PMNode, type Schema } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import type * as Y from 'yjs';
import { bindingPlugin, redo, undo } from './binding';
import { readRegion, writeRegion, type SourceNode } from './html';
import { readText } from './lines';
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

/**
 * A paste (or any copy) can repeat a block's id. The block that held the id before the change keeps it; every other
 * copy loses it (the first in order, if the holder is gone).
 */
const dedupeKey = new PluginKey('live-region-ids');
function idDedupe(): Plugin {
  return new Plugin({
    key: dedupeKey,
    appendTransaction(transactions, old, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const holders = new Map<string, number>();
      old.doc.forEach((block, offset) => {
        let pos = offset;
        for (const tr of transactions) pos = tr.mapping.map(pos, 1);
        for (const name of ID_ATTRS) if (typeof block.attrs[name] === 'string') holders.set(block.attrs[name], pos);
      });
      const count = new Map<string, number>();
      state.doc.forEach((block) => { for (const name of ID_ATTRS) if (typeof block.attrs[name] === 'string') count.set(block.attrs[name], (count.get(block.attrs[name]) ?? 0) + 1); });
      const kept = new Set<string>();
      state.doc.forEach((block, offset) => { for (const name of ID_ATTRS) { const id = block.attrs[name]; if (typeof id === 'string' && count.get(id)! > 1 && holders.get(id) === offset) kept.add(`${id}@${offset}`); } });
      const seen = new Set<string>();
      let tr: Transaction | null = null;
      state.doc.forEach((block, offset) => {
        let attrs: Record<string, unknown> | null = null;
        for (const name of ID_ATTRS) {
          const id = block.attrs[name];
          if (typeof id !== 'string' || count.get(id)! < 2) continue;
          const holderKept = [...kept].some((key) => key.startsWith(`${id}@`));
          const keep = holderKept ? kept.has(`${id}@${offset}`) : !seen.has(id);
          if (keep) seen.add(id); else (attrs ??= { ...block.attrs })[name] = null;
        }
        if (attrs) (tr ??= state.tr).setNodeMarkup(offset, undefined, attrs);
      });
      const changes = tr as Transaction | null;
      return changes ? changes.setMeta('addToHistory', false) : null;
    },
  });
}

/**
 * A paragraph's text holds no line break: its line end is the block boundary. A "\n" put into one (an insertText,
 * a composition) becomes a space, so the editor shows exactly what the shared text holds.
 */
function lineBreaks(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      let tr: Transaction | null = null;
      state.doc.descendants((node, pos, parent) => {
        if (!node.isText || parent?.type.spec.code) return node.isBlock;
        const text = node.text!;
        for (let at = 0; at < text.length; at++) if (text[at] === '\n' || text[at] === '\r') (tr ??= state.tr).insertText(' ', pos + at, pos + at + 1);
        return false;
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

interface RegionCommands {
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
  /** Enter: at a block's start an empty block goes before it; at its end an empty block goes after it; in the middle
   * the text after the cursor keeps the block's ids and the text before becomes a new block with the same structure.
   * In every case the original line end, which holds the ids, stays where it was. Enter in an empty list item or
   * quote leaves it. */
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
      const start = $at.before(1);
      tr.split($at.pos, 1, [{ type: schema.nodes.textblock!, attrs: atEnd ? empty : $at.parent.attrs }]);
      // In the middle, the text after the cursor keeps the block's ids: in the shared text it keeps the original line
      // end, so the ids never move and an undo of the split has nothing else to restore.
      if (!atEnd) tr.setNodeMarkup(start, undefined, { ...tr.doc.nodeAt(start)!.attrs, afId: null, itemId: null, listId: null, quoteId: null });
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
  /** Converting to or from a code block reformats the block's lines; nobody's concurrent typing is touched. */
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
  return { splitBlock, backspace, indent, outdent, heading, list, quote, codeBlock, strong: mark('strong'), em: mark('em'), code: mark('code'), link, undo, redo };
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
      // The rule is a new line before the paragraph, which keeps its text, ids and anyone's concurrent typing.
      const from = $start.before(1);
      // Inserted while the dashes are still there, so the new line is unambiguously the one before the paragraph.
      const tr = state.tr.insert(from, schema.nodes.rule!.create({ quote: node.attrs.quote })).delete(start + 1, end + 1);
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
 * `**x**`, `*x*` and `` `x` `` typed: the closing delimiter, then the opening one, are deleted and the mark added,
 * as three steps of one transaction; the binding writes each step as its own small edit, so the text between the
 * delimiters is never rewritten.
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
          const tr = view.state.tr;
          if (shortcut.width > 1) tr.delete(from - (shortcut.width - 1), from);
          tr.delete(start, start + shortcut.width).addMark(start, start + found[1]!.length, type.create()).removeStoredMark(type);
          view.dispatch(tr);
          return true;
        }
        return false;
      },
    },
  });
}

/**
 * The editor plugins of a region bound to its text: the binding (sync, and undo of the person's own edits), the id
 * dedupe, Markdown input rules, the keymap and the region clipboard.
 */
function editorPlugins(kind: RegionKind, text: Y.Text, terminated: boolean): Plugin[] {
  const schema = regionSchema(kind);
  const commands = regionCommands(kind);
  return [
    bindingPlugin(kind, text, terminated),
    idDedupe(),
    lineBreaks(),
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

/** The editor state of a region: its document is read from the shared text, never parsed by the client. */
export function editorState(kind: RegionKind, text: Y.Text): EditorState {
  const { doc, terminated } = readText(kind, text);
  return EditorState.create({ schema: regionSchema(kind), doc, plugins: editorPlugins(kind, text, terminated) });
}
