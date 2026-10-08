/**
 * Tab and Shift-Tab: a list item nests, code indents its lines, and any other block indents a level
 * (an `ml-*` step, typography's INDENT_SCALE). Either way the key stays in the document: it never moves focus out.
 */
import { TextSelection, type Command } from 'prosemirror-state';
import type { ResolvedPos } from 'prosemirror-model';
import { sinkListItem, liftListItem } from 'prosemirror-schema-list';
import type { JsxElement } from '@/lib/jsx';
import { currentIndentLevel, stepIndentClass } from '@/lib/data/story/typography';
import { editorSchema } from './model';

const CODE_INDENT = '  ';

function inListItem($at: ResolvedPos): boolean {
  for (let depth = $at.depth - 1; depth > 0; depth--) if ($at.node(depth).type === editorSchema.nodes.list_item) return true;
  return false;
}

function classOf(source: JsxElement | null): string {
  const value = source?.attributes.find(a => a.name === 'className' || a.name === 'class')?.value;
  return value?.static && typeof value.json === 'string' ? value.json : '';
}

function withClass(source: JsxElement | null, tag: string, className: string): JsxElement {
  const original: JsxElement = source ?? { type: 'element', tag, isComponent: false, attributes: [], children: [], selfClosing: false, start: 0, end: 0 };
  const attributes = original.attributes.filter(a => a.name !== 'className' && a.name !== 'class');
  if (className) attributes.push({ name: 'className', value: { static: true, json: className }, start: 0, end: 0 });
  return { ...original, attributes };
}

/** Indent or outdent the selected lines of a code block; a bare caret takes Tab as two spaces. */
const indentCode = (direction: 1 | -1): Command => (state, dispatch) => {
  const { $from, from, to, empty } = state.selection;
  if (direction === 1 && empty) {
    dispatch?.(state.tr.insertText(CODE_INDENT).setMeta('mx-command', true));
    return true;
  }
  const start = $from.start(), text = $from.parent.textBetween(0, $from.parent.content.size, '\n', '￼');
  const lines = [0];
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) lines.push(at + 1);
  const selected = lines.filter((line, index) => line <= Math.min(to, $from.end()) - start && (lines[index + 1] ?? Infinity) > from - start);
  const tr = state.tr;
  // Last line first, so the earlier line starts stay where they were.
  for (const line of selected.reverse()) {
    if (direction === 1) tr.insertText(CODE_INDENT, start + line);
    else {
      const spaces = /^ {0,2}/.exec(text.slice(line))![0].length;
      if (spaces) tr.delete(start + line, start + line + spaces);
    }
  }
  if (tr.docChanged) dispatch?.(tr.setMeta('mx-command', true));
  return true;
};

export const indentBlocks = (direction: 1 | -1): Command => (state, dispatch, view) => {
  if (view?.composing) return true;
  const { $from, from, to } = state.selection;
  if (inListItem($from)) {
    (direction === 1 ? sinkListItem : liftListItem)(editorSchema.nodes.list_item)(state, dispatch);
    return true;
  }
  if ($from.parent.attrs.tag === 'pre') return indentCode(direction)(state, dispatch);
  const tr = state.tr;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type !== editorSchema.nodes.paragraph) return true;
    // A synthetic run has no element of its own to carry the indent; code keeps its own lines.
    if (node.attrs.synthetic || node.attrs.tag === 'pre') return false;
    const before = classOf(node.attrs.source), after = stepIndentClass(before, direction);
    if (after !== before) tr.setNodeMarkup(pos, undefined, { ...node.attrs, source: withClass(node.attrs.source, node.attrs.tag, after) });
    return false;
  });
  if (tr.docChanged) dispatch?.(tr.setSelection(TextSelection.create(tr.doc, from, to)).setMeta('mx-command', true));
  return true;
};

/** Backspace at the very start of an indented block outdents it before it joins anything. */
export const outdentAtStart: Command = (state, dispatch, view) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset > 0 || $from.parent.attrs.synthetic || $from.parent.attrs.tag === 'pre' || inListItem($from)) return false;
  if (!currentIndentLevel(classOf($from.parent.attrs.source))) return false;
  return indentBlocks(-1)(state, dispatch, view);
};
