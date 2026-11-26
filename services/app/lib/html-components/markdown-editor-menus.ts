/**
 * Internal: af-markdown-editor's toolbar panels. Table: insert a chosen grid, or add and delete
 * rows, columns and the table at the caret. Image: insert one by address (https, relative or an
 * upload's ref:<id>) and alt text, or change or delete the selected one; Markdown has no image
 * size. Used by markdown-editor.ts; each field keeps its own panels and labels.
 */
import { NodeSelection, type Command, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { imageAllowed } from '../markdown/display';
import { editTable, insertTable, inTable, maxDimension } from './markdown-editor-table-commands';

type View = () => EditorView;
const button = (doc: Document, key: string, text: string, className = '') => {
  const element = doc.createElement('button');
  element.type = 'button'; element.dataset.key = key; element.textContent = text;
  if (className) element.className = className;
  return element;
};
const field = (doc: Document, name: string) => {
  const label = doc.createElement('label'), input = doc.createElement('input');
  label.textContent = name; input.setAttribute('aria-label', name);
  label.append(input);
  return { label, input };
};
const group = (doc: Document, className: string, ...children: HTMLElement[]) => {
  const element = doc.createElement('div');
  element.className = className; element.append(...children);
  return element;
};

/** A toolbar trigger and its panel: `open` fills the panel and returns what takes focus. */
function panel(toolbar: HTMLElement, frame: HTMLElement, id: string, key: string, text: string,
  view: View, editable: () => boolean, open: () => HTMLElement, submit: () => void) {
  const trigger = button(toolbar.ownerDocument, key, text, 'af-md-table-trigger');
  trigger.setAttribute('aria-controls', id);
  trigger.setAttribute('aria-expanded', 'false');
  toolbar.append(trigger);
  const box = group(toolbar.ownerDocument, 'af-md-table-panel');
  box.id = id; box.hidden = true; box.setAttribute('role', 'group');
  frame.append(box);
  const close = () => { box.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
  trigger.addEventListener('mousedown', event => event.preventDefault());
  trigger.addEventListener('click', () => {
    if (!box.hidden) { close(); view().focus(); return; }
    if (trigger.disabled) return;
    const focus = open();
    box.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    focus.focus();
    if (focus instanceof HTMLInputElement) focus.select();
  });
  box.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault(); close(); trigger.focus();
    } else if (event.key === 'Enter' && (event.target as Element).localName === 'input') {
      event.preventDefault(); submit();
    }
  });
  box.addEventListener('focusout', event => {
    if (event.relatedTarget !== trigger && !box.contains(event.relatedTarget as Node)) close();
  });
  return {
    box,
    /** Run `command` while editable; once it applies, close and return to the text. */
    run(command: Command) {
      const editor = view();
      if (editable() && command(editor.state, editor.dispatch, editor)) { close(); editor.focus(); }
    },
    /** Name the trigger and panel for what they do here; a new purpose closes the panel. */
    label(title: string, disabled: boolean) {
      trigger.title = title; trigger.setAttribute('aria-label', title);
      trigger.disabled = disabled;
      if (disabled || box.getAttribute('aria-label') !== title) close();
      box.setAttribute('aria-label', title);
    },
  };
}

export function tableMenu(toolbar: HTMLElement, frame: HTMLElement, id: string, view: View,
  editable: () => boolean) {
  const doc = toolbar.ownerDocument;
  const rows = field(doc, 'Rows'), columns = field(doc, 'Columns');
  for (const [{ input }, value] of [[rows, 3], [columns, 2]] as const) {
    input.type = 'number'; input.min = '1'; input.max = String(maxDimension);
    input.required = true; input.value = String(value);
  }
  const fields = group(doc, 'af-md-table-fields', rows.label, columns.label);
  const create = button(doc, 'insert-table', 'Insert table', 'af-md-table-primary');
  const actions = group(doc, 'af-md-table-actions');
  const commands = ([
    ['row-after', 'Add row below'], ['column-after', 'Add column to the right'],
    ['delete-row', 'Delete row'], ['delete-column', 'Delete column'],
    ['delete-table', 'Delete table'],
  ] as const).map(([key, text]) => ({ command: editTable(key),
    button: button(doc, key, text, key === 'delete-table' ? 'af-md-table-danger' : '') }));
  const submit = () => {
    if (rows.input.reportValidity() && columns.input.reportValidity()) {
      menu.run(insertTable(rows.input.valueAsNumber, columns.input.valueAsNumber));
    }
  };
  const menu = panel(toolbar, frame, id, 'table', 'Table', view, editable, () => {
    const state = view().state;
    if (!inTable(state)) {
      actions.replaceChildren(create); menu.box.replaceChildren(fields, actions);
      return rows.input;
    }
    for (const { command, button } of commands) button.disabled = !command(state);
    actions.replaceChildren(...commands.map(item => item.button));
    menu.box.replaceChildren(actions);
    return commands[0]!.button;
  }, submit);
  create.addEventListener('click', submit);
  for (const { command, button } of commands) {
    button.addEventListener('click', () => menu.run(command));
  }
  return () => {
    const state = view().state, existing = inTable(state);
    menu.label(existing ? 'Table options' : 'Insert table',
      !editable() || (!existing && !insertTable(1, 1)(state)));
  };
}

const selectedImage = (state: EditorState) => state.selection instanceof NodeSelection &&
  state.selection.node.type.name === 'image' ? state.selection : null;
const canInsert = (state: EditorState) => {
  const { $from } = state.selection, image = state.schema.nodes.image;
  return !!image && $from.parent.canReplaceWith($from.index(), $from.index(), image);
};

export function imageMenu(toolbar: HTMLElement, frame: HTMLElement, id: string, view: View,
  editable: () => boolean) {
  const doc = toolbar.ownerDocument;
  const address = field(doc, 'Address'), alt = field(doc, 'Alt text');
  address.input.required = true; address.input.placeholder = 'https://…';
  address.input.addEventListener('input', () => address.input.setCustomValidity(''));
  const fields = group(doc, 'af-md-table-fields', address.label, alt.label);
  const save = button(doc, 'insert-image', 'Insert image', 'af-md-table-primary');
  const remove = button(doc, 'delete-image', 'Delete image', 'af-md-table-danger');
  const actions = group(doc, 'af-md-table-actions');
  const submit = () => {
    const src = address.input.value.trim();
    address.input.setCustomValidity(src && imageAllowed(src) ? '' :
      'Use an https address, a relative address or ref:<id>');
    if (address.input.reportValidity()) menu.run((state, dispatch) => {
      const image = selectedImage(state);
      const attrs = { ...image?.node.attrs, src, alt: alt.input.value };
      if (!image && !canInsert(state)) return false;
      dispatch?.((image ? state.tr.setNodeMarkup(image.from, undefined, attrs)
        : state.tr.replaceSelectionWith(state.schema.nodes.image!.create(attrs))).scrollIntoView());
      return true;
    });
  };
  const menu = panel(toolbar, frame, id, 'image', 'Image', view, editable, () => {
    const image = selectedImage(view().state);
    address.input.value = String(image?.node.attrs.src ?? '');
    alt.input.value = String(image?.node.attrs.alt ?? '');
    address.input.setCustomValidity('');
    save.textContent = image ? 'Save image' : 'Insert image';
    actions.replaceChildren(save, ...(image ? [remove] : []));
    menu.box.replaceChildren(fields, actions);
    return address.input;
  }, submit);
  save.addEventListener('click', submit);
  remove.addEventListener('click', () => menu.run((state, dispatch) => {
    dispatch?.(state.tr.deleteSelection().scrollIntoView());
    return true;
  }));
  return () => {
    const state = view().state, image = selectedImage(state);
    menu.label(image ? 'Edit image' : 'Insert image', !editable() || (!image && !canInsert(state)));
  };
}
