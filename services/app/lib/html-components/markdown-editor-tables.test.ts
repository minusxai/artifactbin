// @vitest-environment jsdom
import { DOMParser, DOMSerializer } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { mountEditor } from './markdown-editor-commands';
import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { editorSchema, normalizeMarkdown, parseMarkdown, serializeMarkdown }
  from './markdown-editor-model';

const source = [
  'Before.',
  '',
  '| Surface | Event time | Notes |',
  '| :--- | :---: | ---: |',
  '| **Desktop** | `event_ts` | literal \\| pipe and `a\\|b` |',
  '| *Mobile* | [local](/docs) | ~~old~~ |',
  '',
  'After.',
].join('\n');

describe('Markdown editor pipe tables', () => {
  it('opens semantic headers and editable marked cells, retaining column alignment', () => {
    const table = parseMarkdown(source).child(1);
    expect(table.type.name).toBe('table');
    expect(table.child(0).child(0).type.name).toBe('tableHeader');
    expect(table.child(1).child(1).type.name).toBe('tableCell');
    expect(table.child(1).child(2).lastChild?.text).toBe('a|b');
    expect(table.child(1).child(2).lastChild?.marks[0]?.type.name).toBe('code');
    const dom = DOMSerializer.fromSchema(editorSchema).serializeNode(table) as HTMLElement;
    expect(dom.querySelectorAll('th')).toHaveLength(3);
    const centered = [...dom.querySelectorAll('td')].find(cell => cell.style.textAlign === 'center');
    expect(centered?.querySelector('code')?.textContent).toBe('event_ts');
    expect(normalizeMarkdown(source)).toBe(source);
  });

  it('saves one edited cell and reopens all other cells, marks, and surrounding blocks', () => {
    const doc = parseMarkdown(source);
    let cellStart = 0;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Desktop') cellStart = pos;
    });
    expect(cellStart).toBeGreaterThan(0);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, cellStart + 7) });
    const edited = state.apply(state.tr.insertText(' client'));
    const markdown = serializeMarkdown(edited.doc);
    expect(markdown).toBe(source.replace('**Desktop**', '**Desktop client**'));
    expect(parseMarkdown(markdown).eq(edited.doc)).toBe(true);
  });

  it('keeps every column when a pasted HTML table has a wider body than its header', () => {
    const fragment = document.createElement('div');
    fragment.innerHTML = '<table><tr><th>First</th></tr>' +
      '<tr><td>One</td><td><code>Two|Three</code></td></tr></table>';
    const doc = DOMParser.fromSchema(editorSchema).parse(fragment);
    const restored = parseMarkdown(serializeMarkdown(doc)).firstChild!;
    expect(restored.firstChild?.childCount).toBe(2);
    expect(restored.child(1).child(1).textContent).toBe('Two|Three');
    expect(restored.child(1).child(1).firstChild?.marks[0]?.type.name).toBe('code');
  });

  it('supports single-column and header-only tables and tables inside a quoted list', () => {
    for (const input of ['| Label |\n| --- |', '| A | B |\n| --- | --- |\n|  |  |',
      '> - Intro\n>\n>   | Header |\n>   | --- |\n>   | Word |']) {
      const doc = parseMarkdown(input);
      const blocks: string[] = [];
      doc.descendants(node => { blocks.push(node.type.name); });
      expect(blocks).toContain('table');
      expect(parseMarkdown(serializeMarkdown(doc)).eq(doc)).toBe(true);
    }
    expect(parseMarkdown('x | y\nnot a delimiter').firstChild?.type.name).toBe('paragraph');
    expect(parseMarkdown('```\n| a |\n| --- |\n```').firstChild?.type.name).toBe('codeBlock');
  });
});

it('pastes a Markdown table into prose and preserves default HTML, prose and code pastes', () => {
  const mount = (markdown: string) => mountEditor(document.createElement('div'), markdown).view;
  const paste = (view: EditorView, text: string, html?: string) => {
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: {
      getData: (type: string) => type === 'text/plain' ? text : type === 'text/html' ? html ?? '' : '',
    } });
    view.dom.dispatchEvent(event);
  };
  const table = '| ID | Time |\n| --- | --- |\n| a | `ts` |';
  const view = mount('');
  try {
    paste(view, table);
    expect(view.dom.querySelector('tbody td code')?.textContent).toBe('ts');
    expect(serializeMarkdown(view.state.doc)).toBe(table);
  } finally { view.destroy(); }

  const prose = mount('');
  try {
    // Shift held (Mod-Shift-V) pastes text as typed; without it, text pastes as Markdown.
    prose.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', keyCode: 16, shiftKey: true }));
    paste(prose, '*literal*');
    prose.dom.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', keyCode: 16 }));
    expect(prose.dom.querySelector('em')).toBeNull();
    expect(prose.state.doc.textContent).toBe('*literal*');
    paste(prose, table, '<p><em>HTML wins</em></p>');
    expect(prose.dom.querySelector('em')?.textContent).toBe('HTML wins');
    expect(prose.dom.querySelector('table')).toBeNull();
  } finally { prose.destroy(); }
  const markdown = mount('');
  try {
    paste(markdown, 'Before *read* [here](https://x.dev)\n\n- one');
    expect(markdown.dom.querySelector('p em')?.textContent).toBe('read');
    expect(serializeMarkdown(markdown.state.doc)).toBe('Before *read* [here](https://x.dev)\n\n- one');
  } finally { markdown.destroy(); }

  for (const html of [
    '<table><tr><td>Totals</td></tr><tr><td>One</td><td>Two</td></tr></table>',
    '<table><tr><th colspan="2">Totals</th></tr><tr><td>One</td><td>Two</td></tr></table>',
  ]) {
    const merged = mount('');
    try {
      paste(merged, '', html);
      expect(merged.dom.querySelector('table')).toBeNull();
      expect(merged.state.doc.textContent).toContain('Totals');
      expect(merged.state.doc.textContent).toContain('One');
      expect(merged.state.doc.textContent).toContain('Two');
    } finally { merged.destroy(); }
  }
  const htmlTable = mount('');
  try {
    paste(htmlTable, '', '<table><tr><td>Title</td></tr><tr><td><b>Data</b></td></tr></table>');
    expect(htmlTable.dom.querySelector('th')?.textContent).toBe('Title');
    expect(htmlTable.dom.querySelector('td strong')?.textContent).toBe('Data');
  } finally { htmlTable.destroy(); }

  const inCell = mount('| Header |\n| --- |\n| Value |');
  try {
    const end = TextSelection.atEnd(inCell.state.doc);
    inCell.dispatch(inCell.state.tr.setSelection(end));
    paste(inCell, table);
    expect(inCell.dom.querySelectorAll('table')).toHaveLength(1);
    expect(inCell.dom.querySelector('td')?.textContent).toContain('Value');
  } finally { inCell.destroy(); }

  const code = mount('```\ncode\n```');
  try {
    paste(code, table);
    expect(code.dom.querySelector('pre')?.textContent).toContain('| ID | Time |');
    expect(code.dom.querySelector('table')).toBeNull();
  } finally { code.destroy(); }
});

it('opens a saved table whose rows are separated by blank paragraphs', () => {
  const spaced = '| Key | Value |\n\n|---|---|\n\n| A | one |\n\n| B | two |';
  const doc = parseMarkdown('Intro.\n\n' + spaced + '\n\nAfter.');
  expect(doc.child(1).type.name).toBe('table');
  expect(doc.child(1).childCount).toBe(3);
  expect(parseMarkdown(serializeMarkdown(doc)).eq(doc)).toBe(true);
  expect(parseMarkdown('```\n' + spaced + '\n```').firstChild?.textContent).toBe(spaced);
  expect(parseMarkdown('| A |\n\n|---|---|\n\n| B |').firstChild?.type.name).toBe('paragraph');
});
