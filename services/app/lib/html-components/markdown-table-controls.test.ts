// @vitest-environment jsdom
// The Markdown table toolbar, editing commands and keyboard navigation share one editor state.
import { afterEach, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { editTable, insertTable } from './markdown-editor-table-commands';
import { mountEditor } from './markdown-editor-commands';
import { parseMarkdown, serializeMarkdown } from './markdown-editor-model';
import './markdown-editor';

afterEach(() => document.body.replaceChildren());

function mount(source = '') {
  const field = document.createElement('af-markdown-editor');
  field.setAttribute('default-value', source);
  document.body.append(field);
  const button = (key: string) => field.querySelector<HTMLButtonElement>(`button[data-key="${key}"]`)!;
  return { field, button };
}

it('inserts the chosen grid, focuses its first header and edits it through the same toolbar', () => {
  const { field, button } = mount();
  const events: string[] = [];
  field.addEventListener('af-change', e => events.push((e as CustomEvent).detail.value));
  button('table').click();
  const rows = field.querySelector<HTMLInputElement>('input[aria-label="Rows"]')!;
  const columns = field.querySelector<HTMLInputElement>('input[aria-label="Columns"]')!;
  rows.value = '2'; columns.value = '3';
  button('insert-table').click();
  expect(field.querySelectorAll('th')).toHaveLength(3);
  expect(field.querySelectorAll('td')).toHaveLength(3);
  expect(events).toHaveLength(1);
  expect(button('rule').disabled).toBe(true);
  expect(button('h1').disabled).toBe(true);
  expect(button('bold').disabled).toBe(false);
  expect(document.activeElement).toBe(field.querySelector('.ProseMirror'));
  button('table').click();
  expect(button('delete-row').disabled).toBe(true);
  button('row-after').click();
  expect(field.querySelectorAll('td')).toHaveLength(6);
  button('table').click(); button('column-after').click();
  expect(field.querySelectorAll('th')).toHaveLength(4);
  button('table').click(); button('delete-column').click();
  button('table').click(); button('delete-row').click();
  expect(field.querySelectorAll('th')).toHaveLength(3);
  expect(field.querySelectorAll('td')).toHaveLength(3);
  button('table').click(); button('delete-table').click();
  expect(field.querySelector('table')).toBeNull();
  expect(events.at(-1)).toBeNull();
});

it('cancels insertion with Escape and cannot insert while read-only', () => {
  const { field, button } = mount('Keep this');
  button('table').click();
  const rows = field.querySelector<HTMLInputElement>('input[aria-label="Rows"]')!;
  expect(document.activeElement).toBe(rows);
  rows.value = '0';
  button('insert-table').click();
  expect(field.querySelector('table')).toBeNull();
  rows.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(button('table').getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(button('table'));
  field.setAttribute('readonly', '');
  expect(button('table').disabled).toBe(true);
});

it('moves through cells with Tab and Shift-Tab, and exits a final table with Enter', () => {
  const editor = mountEditor(document.body, '| A | B |\n| --- | --- |\n| 1 | 2 |');
  const view = editor.view, doc = view.state.doc;
  const key = (key: string, shiftKey = false) => view.dom.dispatchEvent(new KeyboardEvent('keydown', {
    key, shiftKey, cancelable: true, bubbles: true,
  }));
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.atStart(doc)));
    key('Tab'); expect(view.state.selection.$from.parent.textContent).toBe('B');
    key('Tab', true); expect(view.state.selection.$from.parent.textContent).toBe('A');
    key('Enter'); expect(view.state.selection.$from.parent.textContent).toBe('1');
    key('Tab'); key('Enter');
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
    view.dispatch(view.state.tr.insertText('After'));
    expect(serializeMarkdown(view.state.doc)).toMatch(/\n\nAfter$/);
  } finally { editor.destroy(); }
});

it('inserts between surrounding prose and leaves code and nested blocks intact', () => {
  let state = EditorState.create({ doc: parseMarkdown('beforeafter') });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 7)));
  expect(insertTable(2, 2)(state, tr => { state = state.apply(tr); })).toBe(true);
  expect(state.doc.firstChild?.textContent).toBe('before');
  expect(state.doc.lastChild?.textContent).toBe('after');
  expect(state.selection.$from.parent.type.name).toBe('tableHeader');
  const doc = parseMarkdown('## Heading\n\n| Old |\n| --- |\n| a |\n\nFinal paragraph');
  for (const split of [TextSelection.atStart(doc), TextSelection.atEnd(doc)]) {
    state = EditorState.create({ doc, selection: split });
    expect(insertTable(3, 2)(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.content.content.filter(node => node.type.name === 'table')).toHaveLength(2);
    expect(state.selection.$from.parent.type.name).toBe('tableHeader');
  }
  for (const source of ['- in list', '> in quote', '```\ncode\n```']) {
    state = EditorState.create({ doc: parseMarkdown(source) });
    expect(insertTable(2, 2)(state)).toBe(false);
  }
});

it('keeps the header, column alignment and neighboring values through structural edits', () => {
  let state = EditorState.create({ doc: parseMarkdown('| Key | Value |\n| --- | ---: |\n| id | 42 |') });
  const apply = (tr: Parameters<EditorState['apply']>[0]) => { state = state.apply(tr); };
  expect(editTable('row-after')(state, apply)).toBe(true);
  const table = state.doc.firstChild!;
  expect(table.child(1).child(1).attrs.align).toBe('right');
  expect(table.child(2).child(1).textContent).toBe('42');
  expect(editTable('delete-row')(state, apply)).toBe(true);
  expect(serializeMarkdown(state.doc)).toContain('| id | 42 |');
  expect(editTable('delete-column')(state, apply)).toBe(true);
  expect(editTable('delete-column')(state)).toBe(false);
  expect(state.doc.firstChild!.child(0).textContent).toBe('Value');
});

it('keeps a grid editable after replacing a text selection spanning multiple table rows', () => {
  const editor = mountEditor(document.createElement('div'), '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |');
  const doc = editor.state.doc;
  const positions = new Map<string, number>();
  doc.descendants((node, pos) => { if (node.isText) positions.set(node.text!, pos); });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, positions.get('B')!, positions.get('2')!)));
  editor.view.dispatch(editor.state.tr.insertText('Q'));
  let state = editor.state; editor.destroy();
  const table = state.doc.firstChild!;
  expect(table.firstChild!.content.content.map(cell => cell.type.name))
    .toEqual(['tableHeader', 'tableHeader', 'tableHeader']);
  expect(table.child(1).childCount).toBe(3);
  expect(state.selection.$from.parent.textContent).toBe('Q2');
  expect(editTable('column-after')(state, tr => { state = state.apply(tr); })).toBe(true);
  expect(state.doc.firstChild!.firstChild!.childCount).toBe(4);
});
