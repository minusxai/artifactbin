/** Markdown typing returns source-backed commands; the view owns dispatch and history. */
import type { ResolvedPos } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction, type Command } from 'prosemirror-state';
import { splitBlock } from 'prosemirror-commands';
import type { JsxElement } from '@/lib/jsx';
import { editorSchema } from './model';

export const BLOCK_SHORTCUT = /^(#{1,6}|[*-]|1\.|>|\[ ?\]|\[[xX]\]|```|---)[ \u00a0]$/;

/** Authored paragraphs only: never code, list items, cells, synthetic runs or inline code. */
export function ordinaryParagraph($at: ResolvedPos): boolean {
  const block = $at.parent;
  if (block.type !== editorSchema.nodes.paragraph || block.attrs.tag !== 'p' || block.attrs.synthetic) return false;
  for (let depth = $at.depth - 1; depth > 0; depth--)
    if (['list_item', 'table_cell'].includes($at.node(depth).type.name)) return false;
  return !$at.marks().some(mark => mark.attrs.tag === 'code');
}

/** Keep comment anchors and identity; let the new structure supply its own typography. */
function identityOnly(source: JsxElement | null): JsxElement | null {
  return source && { ...source, attributes: source.attributes.filter(a => ['id', 'data-annotation-anchor', 'dir', 'lang'].includes(a.name)) };
}

export function blockShortcut(state: EditorState, onEnter = false): Transaction | null {
  const { $from, empty } = state.selection;
  if (!empty || !ordinaryParagraph($from)) return null;
  const typed = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
  const marker = onEnter ? (/^(```|---)$/.test(typed) ? typed : null) : BLOCK_SHORTCUT.exec(typed)?.[1];
  if (!marker) return null;
  const start = $from.start();
  const tr = state.tr.delete(start, start + typed.length);
  const paragraph = { ...$from.parent.attrs, source: identityOnly($from.parent.attrs.source as JsxElement | null) };
  if (marker === '---') {
    const at = $from.before();
    const rest = tr.doc.nodeAt(at)!.content;
    tr.replaceWith(at, tr.mapping.map($from.after()), [
      editorSchema.nodes.horizontal_rule.create({ ...paragraph, tag: 'hr' }),
      editorSchema.nodes.paragraph.create(null, rest),
    ]);
    return tr.setSelection(TextSelection.create(tr.doc, at + 2)).setStoredMarks([]);
  }
  if (marker.startsWith('#') || marker === '```')
    return tr.setNodeMarkup($from.before(), undefined, { ...paragraph, tag: marker === '```' ? 'pre' : `h${marker.length}` }).setStoredMarks([]);
  tr.setNodeMarkup($from.before(), undefined, paragraph);
  if (marker.startsWith('[')) {
    tr.insert(start, [editorSchema.nodes.task_checkbox.create({ checked: /x/i.test(marker) }), editorSchema.text(' ')]);
    return tr.setSelection(TextSelection.create(tr.doc, start + 2));
  }
  const range = tr.doc.resolve(start).blockRange();
  if (!range) return null;
  if (marker === '>') return tr.wrap(range, [{ type: editorSchema.nodes.container, attrs: { tag: 'blockquote' } }]);
  const list = marker === '1.' ? editorSchema.nodes.ordered_list : editorSchema.nodes.bullet_list;
  return tr.wrap(range, [{ type: list }, { type: editorSchema.nodes.list_item }]);
}

/** Checklist paragraphs continue with a fresh unchecked box, or leave the checklist when empty. */
export const splitTask: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const block = $from.parent;
  if (!empty || block.attrs.tag !== 'p' || block.firstChild?.type !== editorSchema.nodes.task_checkbox || $from.parentOffset < 1) return false;
  if (!block.textContent.trim() && block.childCount <= 2) {
    dispatch?.(state.tr.delete($from.start(), $from.end()).setMeta('mx-command', true));
    return true;
  }
  return splitBlock(state, dispatch && (tr => {
    const start = tr.selection.$from.start();
    tr.insert(start, [editorSchema.nodes.task_checkbox.create(), editorSchema.text(' ')]);
    tr.setSelection(TextSelection.create(tr.doc, start + 2));
    dispatch(tr.setMeta('mx-command', true));
  }));
};

/** Code Enter stays literal; Mod-Enter creates a normal paragraph after it. */
export const leaveCode: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.attrs.tag !== 'pre') return false;
  const at = $from.after();
  const tr = state.tr.insert(at, editorSchema.nodes.paragraph.create());
  dispatch?.(tr.setSelection(TextSelection.create(tr.doc, at + 1)).setMeta('mx-command', true).scrollIntoView());
  return true;
};


/** Typed emphasis only: plain spans in authored prose; paste and complex/nested marks stay literal. */
export function inlineShortcut(state: EditorState): Transaction | null {
  const { $from, empty } = state.selection;
  if (!empty || !ordinaryParagraph($from)) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
  const match = /(?:^|[\s(])(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*)$/.exec(before);
  if (!match) return null;
  const text = match[2] ?? match[3]!;
  if (!text.trim() || text !== text.trim() || text.includes('\ufffc')) return null;
  const delimiter = match[2] === undefined ? 1 : 2;
  const start = $from.pos - match[1]!.length;
  const end = $from.pos;
  let plain = true;
  state.doc.nodesBetween(start, end, node => { if (node.isInline && (!node.isText || node.marks.length)) plain = false; });
  if (!plain) return null;
  const tr = state.tr.delete(end - delimiter, end).delete(start, start + delimiter);
  tr.addMark(start, start + text.length, editorSchema.marks.inline.create({ tag: delimiter === 2 ? 'strong' : 'em' }));
  return tr.setSelection(TextSelection.create(tr.doc, start + text.length)).setStoredMarks([]);
}
