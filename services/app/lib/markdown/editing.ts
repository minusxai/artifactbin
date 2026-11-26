/**
 * Editing behaviour the Markdown field (lib/html-components/markdown-editor*) and the document editor
 * (lib/html-runtime/native-editing-behavior.ts) share, on any Tiptap schema with listItem/taskItem nodes:
 *
 * - indentList: Tab and Shift-Tab on list items. In a list it always answers (sinking or lifting when it can, doing
 *   nothing when it cannot), so the key never falls back to editing text; a range ending at the start of an item has
 *   selected none of that item's text. indentNative adds the documents' fallback: outside a list, literal two-space
 *   text indentation, and Shift-Tab without it exits normally.
 * - freshClipboard: a pasted slice as new content: links the caller's rule refuses are dropped (lib/markdown's
 *   linkAllowed by default), titles are capped, and copied element ids (`afId`) are cleared.
 *
 * Neither knows about Yjs: the document editor wraps them in its own undo boundary.
 */
import { createChainableState, type Editor } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { Selection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { linkAllowed } from './href';

const markdownLink = (href: unknown) => typeof href === 'string' && linkAllowed(href);
export function freshClipboard(slice: Slice, allowed: (href: unknown) => boolean = markdownLink): Slice {
  const clean = (node: PMNode): PMNode => {
    const marks = node.marks.flatMap(mark => mark.type.name !== 'link' ? [mark] : allowed(mark.attrs.href)
      ? [mark.type.create({ href: mark.attrs.href, title: typeof mark.attrs.title === 'string' ? mark.attrs.title.slice(0, 512) : null, target: null, rel: 'noopener noreferrer nofollow', class: null })] : []);
    return node.isText ? node.mark(marks) : node.type.create({ ...node.attrs, ...('afId' in node.attrs ? { afId: null } : {}) }, Fragment.fromArray(Array.from({ length: node.childCount }, (_, i) => clean(node.child(i)))), marks);
  };
  return new Slice(Fragment.fromArray(Array.from({ length: slice.content.childCount }, (_, i) => clean(slice.content.child(i)))), slice.openStart, slice.openEnd);
}

function indentText(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, outdent = false): boolean {
  const changes: Array<{ pos: number; remove: number }> = [];
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (!node.isTextblock) return true;
    const remove = outdent ? Math.min(2, /^ */.exec(node.textContent)![0].length) : 0;
    if (!outdent || remove) changes.push({ pos: pos + 1, remove });
    return false;
  });
  if (!changes.length) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const change of changes.reverse()) { if (outdent) tr.delete(change.pos, change.pos + change.remove); else tr.insertText('  ', change.pos); }
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** A range ending at the start of a list item has selected none of that item's text. */
function listIndentState(state: EditorState): EditorState {
  const { doc, selection } = state;
  if (!(selection instanceof TextSelection) || selection.empty) return state;
  const { $to, from, anchor, head } = selection;
  if ($to.parentOffset !== 0 || $to.depth < 2 || $to.index(-1) !== 0 || !['listItem', 'taskItem'].includes($to.node(-1).type.name)) return state;
  const beforeItem = $to.before(-1);
  if (from >= beforeItem) return state;
  const end = Selection.findFrom(doc.resolve(beforeItem), -1, true);
  if (!end || end.head <= from) return state;
  const range = anchor === from ? TextSelection.create(doc, from, end.head) : TextSelection.create(doc, end.head, head);
  return createChainableState({ state, transaction: state.tr.setSelection(range) });
}

/** Nest (or with `outdent`, lift) the list items in the selection; false only when it touches no list item. */
export function indentList(editor: Editor, outdent = false): boolean {
  const { state } = editor;
  let item: string | undefined;
  for (let depth = state.selection.$from.depth; depth > 0; depth--) {
    const name = state.selection.$from.node(depth).type.name;
    if (name === 'listItem' || name === 'taskItem') { item = name; break; }
  }
  state.doc.nodesBetween(state.selection.from, state.selection.to, node => {
    if (!item && (node.type.name === 'listItem' || node.type.name === 'taskItem')) item = node.type.name;
  });
  if (!item) return false;
  (outdent ? liftListItem : sinkListItem)(state.schema.nodes[item]!)(listIndentState(state), editor.view.dispatch);
  return true;
}

/** List indentation never falls back to editing text, even when sinking is impossible; outside lists, text indents. */
export function indentNative(editor: Editor, outdent = false): boolean {
  return indentList(editor, outdent) || indentText(editor.state, editor.view.dispatch, outdent);
}
