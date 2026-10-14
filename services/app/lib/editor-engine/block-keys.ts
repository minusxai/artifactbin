/** Block-scoped keys: Enter in existing HTML checklists and code blocks, and select-all. */
import { TextSelection, type Command } from 'prosemirror-state';
import { splitBlock } from 'prosemirror-commands';
import { editorSchema } from './model';

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

/**
 * Select-all selects the text of the block being edited, never the region. ProseMirror's own select-all is an
 * AllSelection over the whole region, and typing over one replaces the region wholesale: every authored wrapper,
 * inline element and id went, and the typed text came back as a new `<p>` with a minted id. Within one textblock,
 * typing replaces only text, and the marks it was written in (a span, its id) carry over. A checklist's box is
 * the item's state, not its text. Handled even when nothing changes: the browser's own select-all would select
 * across blocks again.
 */
export const selectBlockText: Command = (state, dispatch) => {
  const { $head } = state.selection;
  const block = $head.parent;
  if (!block.isTextblock) return true;
  let from = $head.start();
  if (block.firstChild?.type === editorSchema.nodes.task_checkbox) from += block.firstChild.nodeSize + (block.textBetween(1, 2) === ' ' ? 1 : 0);
  const to = Math.max(from, $head.end());
  dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
  return true;
};
