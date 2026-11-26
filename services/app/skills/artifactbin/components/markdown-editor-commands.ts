/**
 * Internal: af-markdown-editor's toolbar, history, keys and typing rules (`# `, ``` , `> `, `- `,
 * `1. `, `[ ] `, `---`, **b**, *i*, _i_, ~~s~~, `c`; never in code) on the shared Tiptap
 * elements, whose own typing and paste rules are off. Used by: markdown-editor.ts.
 */
import { Editor, Extension, type EditorOptions } from '@tiptap/core';
import type { MarkType, Node as ProseNode, Schema } from 'prosemirror-model';
import { history, redo, undo } from 'prosemirror-history';
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule }
  from 'prosemirror-inputrules';
import { TextSelection, type Command } from 'prosemirror-state';
import { fieldExtensions, markdownContent } from './markdown-editor-model';
import { markdownPaste } from './markdown-editor-paste';
import { moveCell, tableFocus } from './markdown-editor-table-commands';
import { indentList } from '../markdown/editing';

/** One toolbar button: what it does, whether it is on there, and whether it shapes blocks. */
export interface EditorAction { key: string; label: string; title: string;
  run(editor: Editor): boolean; active?(editor: Editor): boolean; block?: boolean }

/** A button for `toggle<Node>` (toggleBold, ...), on where `node` is. */
const toggle = (key: string, label: string, title: string, node: string, block = true) =>
  ({ key, label, title, block, active: (editor: Editor) => editor.isActive(node),
    run: (editor: Editor) => (editor.commands as unknown as Record<string, () => boolean>)[
      `toggle${node[0]!.toUpperCase()}${node.slice(1)}`]!() });
const heading = (level: 1 | 2 | 3): EditorAction => ({ key: `h${level}`, label: `H${level}`,
  title: `Heading ${level}`, block: true, run: editor => editor.commands.toggleHeading({ level }),
  active: editor => editor.isActive('heading', { level }) });

export const toolbarGroups: EditorAction[][] = [
  [heading(1), heading(2), heading(3)],
  [toggle('bold', 'B', 'Bold', 'bold', false), toggle('italic', 'I', 'Italic', 'italic', false),
    toggle('strike', 'S', 'Strikethrough', 'strike', false),
    toggle('code', '</>', 'Inline code', 'code', false)],
  [toggle('bullet', '•', 'Bulleted list', 'bulletList'),
    toggle('ordered', '1.', 'Numbered list', 'orderedList'),
    toggle('task', '☐', 'Task list', 'taskList'), toggle('quote', '❝', 'Quote', 'blockquote'),
    toggle('code-block', '{ }', 'Code block', 'codeBlock'),
    { key: 'rule', label: '―', title: 'Divider', block: true,
      run: editor => editor.commands.setHorizontalRule() }],
];

/** Replace `open text close` just typed with the text carrying the mark; never inside code. */
const markRule = (pattern: RegExp, type: MarkType, code: MarkType) => new InputRule(pattern,
  (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    const before = state.doc.textBetween($start.start(), start);
    if (type !== code && ((before.split('`').length - 1) % 2 === 1 ||
      code.isInSet($start.marks()))) return null;
    const text = match[1]!;
    return state.tr.delete(start, end).insertText(text, start)
      .addMark(start, start + text.length, type.create()).removeStoredMark(type);
  });

/** `[ ] ` or `[x] ` opening a bullet item makes it a task item; opening a paragraph, a task. */
const taskRule = (schema: Schema) => new InputRule(/^\[([ xX])\]\s$/, (state, match, start,
  end) => {
  const { bulletList, listItem, paragraph, taskItem, taskList } = schema.nodes;
  const tr = state.tr.delete(start, end), $start = tr.doc.resolve(start), depth = $start.depth;
  const checked = match[1] !== ' ', parent = depth > 1 ? $start.node(depth - 1) : null;
  if ($start.parent.type !== paragraph) return null;
  if (parent?.type === listItem && !$start.index(depth - 1) &&
    $start.node(depth - 2).type === bulletList) {
    // The item leaves its bullet list, which splits around the new task group.
    const list = $start.node(depth - 2), index = $start.index(depth - 2);
    const at = $start.before(depth - 2), items = list.content.content;
    const group = (part: ProseNode[]) => part.length ? [bulletList!.create(list.attrs, part)] : [];
    const before = group(items.slice(0, index));
    const task = taskList!.create(list.attrs, taskItem!.create({ checked }, parent.content));
    tr.replaceWith(at, at + list.nodeSize, [...before, task, ...group(items.slice(index + 1))]);
    return tr.setSelection(TextSelection.create(tr.doc, at + (before[0]?.nodeSize ?? 0) + 3));
  }
  const range = $start.blockRange();
  if (!range || /^(listItem|taskItem)$/.test(parent?.type.name ?? '') ||
    !range.parent.canReplaceWith(range.startIndex, range.endIndex, taskList!)) return null;
  return tr.wrap(range, [{ type: taskList!, attrs: { tight: true } },
    { type: taskItem!, attrs: { checked } }]);
});

const typingRules = (schema: Schema) => {
  const { nodes, marks } = schema, code = marks.code!;
  return inputRules({ rules: [
    textblockTypeInputRule(/^(#{1,3})\s$/, nodes.heading!, match => ({ level: match[1]!.length })),
    textblockTypeInputRule(/^```$/, nodes.codeBlock!),
    wrappingInputRule(/^\s*>\s$/, nodes.blockquote!),
    taskRule(schema),
    wrappingInputRule(/^\s*([-+*])\s$/, nodes.bulletList!),
    wrappingInputRule(/^(\d+)\.\s$/, nodes.orderedList!, match => ({ start: Number(match[1]) }),
      (match, node) => node.childCount + node.attrs.start === Number(match[1])),
    new InputRule(/^(?:---|\*\*\*|___)$/, (state, _match, start, end) => {
      const $start = state.doc.resolve(start);
      if ($start.parent.type !== nodes.paragraph) return null;
      return state.tr.delete(start, end).replaceRangeWith($start.before(), $start.after(),
        nodes.horizontalRule!.create());
    }),
    markRule(/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, marks.bold!, code),
    markRule(/(?<![*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, marks.italic!, code),
    markRule(/(?<![_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, marks.italic!, code),
    markRule(/~~([^~\s](?:[^~]*[^~\s])?)~~$/, marks.strike!, code),
    markRule(/`([^`]+)`$/, code, code),
  ] });
};

/** Above the elements' own keys: in a table Tab, Shift-Tab, Enter and Shift-Enter move by cell;
 * Tab and Shift-Tab nest list items (lib/markdown/editing.ts, as documents do). */
const FieldBehaviour = Extension.create({
  name: 'markdownFieldBehaviour',
  priority: 1000,
  addProseMirrorPlugins() {
    return [history(), typingRules(this.editor.schema), tableFocus, markdownPaste()];
  },
  addKeyboardShortcuts() {
    const editor = this.editor;
    const run = (command: Command) => command(editor.state, editor.view.dispatch, editor.view);
    return {
      'Mod-z': () => run(undo), 'Shift-Mod-z': () => run(redo), 'Mod-y': () => run(redo),
      'Ctrl-e': () => editor.commands.selectTextblockEnd(),
      ...Object.fromEntries(([1, 2, 3] as const).map(level =>
        [`Mod-Alt-${level}`, () => editor.commands.setHeading({ level })])),
      'Mod-Shift-e': () => editor.commands.toggleCode(),
      'Shift-Enter': () => run(moveCell('down')) || editor.commands.setHardBreak(),
      Enter: () => run(moveCell('down')),
      Tab: () => run(moveCell('next')) || indentList(editor),
      'Shift-Tab': () => run(moveCell('previous')) || indentList(editor, true),
    };
  },
});

/** The field's editor in `element`, holding `source`. */
export const mountEditor = (element: HTMLElement, source: string,
  options: Partial<EditorOptions> = {}): Editor => new Editor({
  ...options, element, content: markdownContent(source),
  extensions: [...fieldExtensions(), FieldBehaviour],
  enableInputRules: false, enablePasteRules: false, injectCSS: false,
});
