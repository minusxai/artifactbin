/** Enter behavior for existing HTML checklists and code blocks. */
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
