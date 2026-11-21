/**
 * Internal: af-markdown-editor's toolbar actions, keyboard shortcuts and Markdown typing rules
 * (`# `, `- `, `1. `, `> `, ``` and `---` at a line start; **bold**, *italic*, ~~strike~~, `code`).
 * Used by: markdown-editor.ts.
 */
import { baseKeymap, chainCommands, exitCode, lift, setBlockType, toggleMark, wrapIn }
  from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule }
  from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import type { MarkType, NodeType } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { Selection, type Command, type EditorState, type Plugin } from 'prosemirror-state';
import { editorSchema as schema } from './markdown-editor-model';

const { nodes, marks } = schema;

/** One toolbar button: what it does and whether it is on where the selection is. */
export interface EditorAction { key: string; label: string; title: string; run: Command;
  active?(state: EditorState): boolean }

const markActive = (type: MarkType) => (state: EditorState): boolean => {
  const { from, $from, to, empty } = state.selection;
  return empty ? !!type.isInSet(state.storedMarks ?? $from.marks())
    : state.doc.rangeHasMark(from, to, type);
};
const ancestor = (state: EditorState, type: NodeType, attrs?: Record<string, unknown>) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type === type && (!attrs || Object.entries(attrs).every(([k, v]) =>
      node.attrs[k] === v))) return true;
  }
  return false;
};
const blockActive = (type: NodeType, attrs?: Record<string, unknown>) =>
  (state: EditorState): boolean => {
    const block = state.selection.$from.parent;
    return block.type === type && (!attrs || Object.entries(attrs).every(([k, v]) =>
      block.attrs[k] === v));
  };
const toggleBlock = (type: NodeType, attrs?: Record<string, unknown>): Command =>
  (state, dispatch) => blockActive(type, attrs)(state)
    ? setBlockType(nodes.paragraph!)(state, dispatch) : setBlockType(type, attrs)(state, dispatch);
const listOf = (type: NodeType) => (state: EditorState): boolean => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === 'bullet_list' || name === 'ordered_list') return $from.node(depth).type === type;
  }
  return false;
};
const toggleList = (type: NodeType): Command => (state, dispatch) =>
  listOf(type)(state) ? liftListItem(nodes.list_item!)(state, dispatch)
    : wrapInList(type)(state, dispatch);
const toggleQuote: Command = (state, dispatch) =>
  ancestor(state, nodes.blockquote!) ? lift(state, dispatch) : wrapIn(nodes.blockquote!)(state,
    dispatch);
const insertRule: Command = (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(nodes.horizontal_rule!.create()).scrollIntoView());
  return true;
};
const hardBreak: Command = chainCommands(exitCode, (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(nodes.hard_break!.create()).scrollIntoView());
  return true;
});

export const toolbarGroups: EditorAction[][] = [
  [
    { key: 'h1', label: 'H1', title: 'Heading 1', run: toggleBlock(nodes.heading!, { level: 1 }),
      active: blockActive(nodes.heading!, { level: 1 }) },
    { key: 'h2', label: 'H2', title: 'Heading 2', run: toggleBlock(nodes.heading!, { level: 2 }),
      active: blockActive(nodes.heading!, { level: 2 }) },
    { key: 'h3', label: 'H3', title: 'Heading 3', run: toggleBlock(nodes.heading!, { level: 3 }),
      active: blockActive(nodes.heading!, { level: 3 }) },
  ],
  [
    { key: 'bold', label: 'B', title: 'Bold', run: toggleMark(marks.strong!),
      active: markActive(marks.strong!) },
    { key: 'italic', label: 'I', title: 'Italic', run: toggleMark(marks.em!),
      active: markActive(marks.em!) },
    { key: 'strike', label: 'S', title: 'Strikethrough', run: toggleMark(marks.strike!),
      active: markActive(marks.strike!) },
    { key: 'code', label: '</>', title: 'Inline code', run: toggleMark(marks.code!),
      active: markActive(marks.code!) },
  ],
  [
    { key: 'bullet', label: '•', title: 'Bulleted list', run: toggleList(nodes.bullet_list!),
      active: listOf(nodes.bullet_list!) },
    { key: 'ordered', label: '1.', title: 'Numbered list', run: toggleList(nodes.ordered_list!),
      active: listOf(nodes.ordered_list!) },
    { key: 'quote', label: '❝', title: 'Quote', run: toggleQuote,
      active: state => ancestor(state, nodes.blockquote!) },
    { key: 'code-block', label: '{ }', title: 'Code block', run: toggleBlock(nodes.code_block!),
      active: blockActive(nodes.code_block!) },
    { key: 'rule', label: '―', title: 'Divider', run: insertRule },
  ],
];

/** Replace `open text close` just typed with the text carrying the mark; never inside code. */
const markRule = (pattern: RegExp, type: MarkType) => new InputRule(pattern,
  (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    const before = state.doc.textBetween($start.start(), start);
    if (type !== marks.code && ((before.split('`').length - 1) % 2 === 1 ||
      marks.code!.isInSet($start.marks()))) return null;
    const text = match[1]!;
    return state.tr.delete(start, end).insertText(text, start)
      .addMark(start, start + text.length, type.create()).removeStoredMark(type);
  });

const rules = inputRules({ rules: [
  textblockTypeInputRule(/^(#{1,3})\s$/, nodes.heading!, match => ({ level: match[1]!.length })),
  textblockTypeInputRule(/^```$/, nodes.code_block!),
  wrappingInputRule(/^\s*>\s$/, nodes.blockquote!),
  wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list!),
  wrappingInputRule(/^(\d+)\.\s$/, nodes.ordered_list!, match => ({ order: Number(match[1]) }),
    (match, node) => node.childCount + node.attrs.order === Number(match[1])),
  new InputRule(/^(?:---|\*\*\*|___)$/, (state, _match, start, end) => {
    const $start = state.doc.resolve(start);
    if ($start.parent.type !== nodes.paragraph) return null;
    return state.tr.delete(start, end).replaceRangeWith($start.before(), $start.after(),
      nodes.horizontal_rule!.create());
  }),
  markRule(/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, marks.strong!),
  markRule(/(?<![*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, marks.em!),
  markRule(/(?<![_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, marks.em!),
  markRule(/~~([^~\s](?:[^~]*[^~\s])?)~~$/, marks.strike!),
  markRule(/`([^`]+)`$/, marks.code!),
] });

/** History, Markdown typing rules and shortcuts, most specific first. */
export function editorPlugins(): Plugin[] {
  const heading = (level: number) => setBlockType(nodes.heading!, { level });
  return [history(), rules, keymap({
    'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo,
    'Mod-b': toggleMark(marks.strong!), 'Mod-i': toggleMark(marks.em!),
    'Mod-Shift-x': toggleMark(marks.strike!), 'Mod-Shift-e': toggleMark(marks.code!),
    'Ctrl-e': (state, dispatch) => {
      dispatch?.(state.tr.setSelection(Selection.atEnd(state.doc)).scrollIntoView());
      return true;
    },
    'Mod-Alt-0': setBlockType(nodes.paragraph!), 'Mod-Alt-1': heading(1),
    'Mod-Alt-2': heading(2), 'Mod-Alt-3': heading(3),
    'Shift-Enter': hardBreak,
    Enter: splitListItem(nodes.list_item!),
    Tab: sinkListItem(nodes.list_item!), 'Shift-Tab': liftListItem(nodes.list_item!),
  }), keymap(baseKeymap)];
}
