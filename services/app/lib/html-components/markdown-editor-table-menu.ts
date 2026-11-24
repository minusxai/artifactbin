/**
 * Internal: the Markdown editor's table picker and contextual row and column controls.
 * Used by markdown-editor.ts. Each field keeps its own selection and labels.
 */
import type { Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { editTable, insertTable, inTable, maxDimension } from './markdown-editor-table-commands';

export function tableMenu(toolbar: HTMLElement, frame: HTMLElement, id: string,
  view: () => EditorView, editable: () => boolean) {
  const doc = toolbar.ownerDocument;
  const makeButton = (key: string, text: string) => {
    const button = doc.createElement('button');
    button.type = 'button'; button.dataset.key = key; button.textContent = text;
    return button;
  };
  const trigger = makeButton('table', 'Table');
  trigger.className = 'af-md-table-trigger';
  trigger.setAttribute('aria-controls', id);
  trigger.setAttribute('aria-expanded', 'false');
  toolbar.append(trigger);
  const panel = doc.createElement('div');
  panel.id = id; panel.className = 'af-md-table-panel'; panel.hidden = true;
  panel.setAttribute('role', 'group');
  frame.append(panel);

  const close = () => {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };
  const run = (command: Command) => {
    const editor = view();
    if (editable() && command(editor.state, editor.dispatch, editor)) {
      close(); editor.focus();
    }
  };
  const input = (name: string, value: number) => {
    const label = doc.createElement('label');
    label.textContent = name;
    const field = doc.createElement('input');
    field.type = 'number'; field.min = '1'; field.max = String(maxDimension);
    field.required = true; field.value = String(value); field.setAttribute('aria-label', name);
    label.append(field);
    return { label, field };
  };
  const fields = doc.createElement('div');
  fields.className = 'af-md-table-fields';
  const rows = input('Rows', 3), columns = input('Columns', 2);
  fields.append(rows.label, columns.label);
  const create = makeButton('insert-table', 'Insert table');
  create.className = 'af-md-table-primary';
  create.addEventListener('click', () => {
    if (rows.field.reportValidity() && columns.field.reportValidity()) {
      run(insertTable(rows.field.valueAsNumber, columns.field.valueAsNumber));
    }
  });
  const actions = doc.createElement('div');
  actions.className = 'af-md-table-actions';
  const commands = [
    ['row-after', 'Add row below'], ['column-after', 'Add column to the right'],
    ['delete-row', 'Delete row'], ['delete-column', 'Delete column'],
    ['delete-table', 'Delete table'],
  ] as const;
  const buttons = commands.map(([key, text]) => {
    const command = editTable(key);
    const button = makeButton(key, text);
    if (key === 'delete-table') button.className = 'af-md-table-danger';
    button.addEventListener('click', () => run(command));
    return { command, button };
  });

  const refresh = () => {
    const state = view().state, existing = inTable(state);
    const title = existing ? 'Table options' : 'Insert table';
    trigger.title = title; trigger.setAttribute('aria-label', title);
    trigger.disabled = !editable() || (!existing && !insertTable(1, 1)(state));
    if (trigger.disabled || panel.getAttribute('aria-label') !== title) close();
    panel.setAttribute('aria-label', title);
  };
  trigger.addEventListener('mousedown', event => event.preventDefault());
  trigger.addEventListener('click', () => {
    if (!panel.hidden) { close(); view().focus(); return; }
    if (trigger.disabled) return;
    const state = view().state, existing = inTable(state);
    if (existing) {
      for (const { command, button } of buttons) button.disabled = !command(state);
      actions.replaceChildren(...buttons.map(item => item.button));
      panel.replaceChildren(actions);
    } else {
      actions.replaceChildren(create); panel.replaceChildren(fields, actions);
    }
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    if (existing) buttons[0]!.button.focus();
    else { rows.field.focus(); rows.field.select(); }
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault(); close(); trigger.focus();
    } else if (event.key === 'Enter' && fields.contains(event.target as Node)) {
      event.preventDefault(); create.click();
    }
  });
  panel.addEventListener('focusout', event => {
    if (event.relatedTarget !== trigger && !panel.contains(event.relatedTarget as Node)) close();
  });
  return refresh;
}
