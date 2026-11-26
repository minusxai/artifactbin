// @vitest-environment jsdom
// af-markdown-editor on the shared Tiptap elements: an untouched value never changes, and what the
// field gained (task lists, images, highlighting, list keys, Markdown paste) beside what it kept.
import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { closeHistory } from 'prosemirror-history';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { mountEditor } from './markdown-editor-commands';
import { serializeMarkdown } from './markdown-editor-model';
import './markdown-editor';

type Field = HTMLElement & { value: string | null };
afterEach(() => document.body.replaceChildren());
const field = (attributes: Record<string, string>) => {
  const element = document.createElement('af-markdown-editor') as Field;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(element);
  const changes: Array<string | null> = [];
  element.addEventListener('af-change', event => changes.push((event as CustomEvent).detail.value));
  const surface = element.querySelector<HTMLElement>('.ProseMirror')!;
  const editor = (surface as HTMLElement & { editor: Editor }).editor;
  const button = (key: string) => element.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!;
  return { element, changes, surface, editor, button };
};
/** Type `text` at the end (a newline presses Enter), through the editor's typing rules. */
const typed = (source: string, text: string) => {
  const editor = mountEditor(document.createElement('div'), source), view = editor.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  for (const char of text) {
    if (char === '\n') { press(editor, 'Enter'); continue; }
    const { from, to } = view.state.selection;
    if (!view.someProp('handleTextInput', handle => handle(view, from, to, char, () => view.state.tr.insertText(char, from, to)))) view.dispatch(view.state.tr.insertText(char, from, to));
  }
  const markdown = serializeMarkdown(view.state.doc); editor.destroy(); return markdown;
};
const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
/** A real key press such as `Mod-Shift-x`; true when the editor handled it. */
const press = (editor: Editor, combo: string) => {
  const parts = combo.split('-'), key = parts.pop()!, has = (name: string) => parts.includes(name);
  const event = new KeyboardEvent('keydown', { key: has('Shift') && key.length === 1 ? key.toUpperCase() : key, keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
    shiftKey: has('Shift'), altKey: has('Alt'), ctrlKey: has('Mod') && !mac, metaKey: has('Mod') && mac, bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
};
const caretIn = (editor: Editor, text: string, offset = 0) => {
  let at = -1;
  editor.state.doc.descendants((node, pos) => { if (at < 0 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text) + offset; });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
};

describe('an untouched value', () => {
  const canonical = ['# Notes\n\nSome **bold**, *em*, ~~gone~~ and `code`.', '- [ ] todo\n- [x] done', '| a | b |\n| :--- | ---: |\n| 1 | 2<br>3 |',
    '![chart](https://i.example/c.png "Chart")', '```ts\nconst a = 1;\n```', '1. one\n2. two\n\n> quoted\n\n---\n\nend'];
  it.each(canonical)('saves back byte for byte: %j', source => {
    const { editor } = field({ value: source });
    expect(serializeMarkdown(editor.state.doc)).toBe(source);
  });
  it.each(['* item\n\n_Unchanged_  \n', '| Key | Value |\n\n|---|---|\n\n| A | one |', '', ...canonical])('emits nothing and keeps its exact text: %j', source => {
    for (const attribute of ['value', 'default-value']) {
      const { element, changes, surface, editor, button } = field({ [attribute]: source });
      editor.commands.focus('end'); surface.dispatchEvent(new FocusEvent('focus')); surface.dispatchEvent(new FocusEvent('blur'));
      button('bold').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      element.querySelector<HTMLButtonElement>('[data-mode="markdown"]')!.click();
      expect(element.querySelector('textarea')!.value).toBe(source);
      element.querySelector<HTMLButtonElement>('[data-mode="visual"]')!.click();
      if (attribute === 'value') element.setAttribute('value', source);
      const other = document.createElement('section'); document.body.append(other); other.append(element);
      expect(changes).toEqual([]);
      expect(element.value).toBe(source || null);
    }
  });
});

describe('what the field gained', () => {
  it('writes task lists from the toolbar, from typed `- [ ] ` and from `[x] ` in a bullet item', () => {
    const { changes, editor, button } = field({ 'default-value': 'Ship it' });
    caretIn(editor, 'Ship'); button('task').click();
    expect(changes.at(-1)).toBe('- [ ] Ship it');
    expect(button('task').getAttribute('aria-pressed')).toBe('true');
    expect(typed('', '- [ ] todo\nnext')).toBe('- [ ] todo\n- [ ] next');
    expect(typed('', '[x] done')).toBe('- [x] done');
    expect(typed('- a\n- b', '\n[ ] c')).toBe('- a\n- b\n- [ ] c');
    expect(typed('1. one', '\n[ ] literal')).toBe('1. one\n2. \\[ ] literal');
    expect(typed('', '`[ ] `')).toBe('`[ ] `');
  });
  it('inserts an image by address and alt text, edits its alt text and address, and deletes it', () => {
    const { element, changes, editor, button } = field({ 'default-value': 'See' });
    editor.commands.focus('end'); button('image').click();
    const address = element.querySelector<HTMLInputElement>('input[aria-label="Address"]')!;
    const alt = element.querySelector<HTMLInputElement>('input[aria-label="Alt text"]')!;
    expect(document.activeElement).toBe(address);
    address.value = 'javascript:alert(1)'; button('insert-image').click();
    expect(address.validationMessage).not.toBe(''); expect(changes).toEqual([]);
    address.value = 'https://i.example/p.png'; alt.value = 'Revenue chart'; button('insert-image').click();
    expect(changes.at(-1)).toBe('See![Revenue chart](https://i.example/p.png)');
    expect(element.querySelector('img[alt="Revenue chart"]')?.getAttribute('src')).toBe('https://i.example/p.png');
    let image = -1; editor.state.doc.descendants((node, pos) => { if (node.type.name === 'image') image = pos; });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, image)));
    button('image').click();
    expect([address.value, alt.value, button('insert-image').textContent]).toEqual(['https://i.example/p.png', 'Revenue chart', 'Save image']);
    address.value = 'ref:abc123'; alt.value = 'Q3'; button('insert-image').click();
    expect(changes.at(-1)).toBe('See![Q3](ref:abc123)');
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, image)));
    button('image').click(); button('delete-image').click();
    expect(changes.at(-1)).toBe('See');
    const code = field({ 'default-value': '```\ncode\n```' });
    caretIn(code.editor, 'code');
    expect(code.button('image').disabled).toBe(true);
  });
  it('highlights code with the shared code tokens', () => {
    const { surface } = field({ value: '```ts\nconst a = 1;\n```' });
    expect(surface.querySelector('pre code .mx-code-token-keyword')?.textContent).toBe('const');
  });
  it('takes the list shortcuts and nests list items with Tab, leaving Tab it cannot use to the page', () => {
    const { changes, editor } = field({ 'default-value': 'one' });
    caretIn(editor, 'one');
    press(editor, 'Mod-Shift-8'); expect(changes.at(-1)).toBe('- one');
    press(editor, 'Mod-Shift-7'); expect(changes.at(-1)).toBe('1. one');
    press(editor, 'Mod-Shift-9'); expect(changes.at(-1)).toBe('- [ ] one');
    const list = field({ 'default-value': '- a\n- b' });
    caretIn(list.editor, 'b');
    expect(press(list.editor, 'Tab')).toBe(true); expect(list.changes.at(-1)).toBe('- a\n  - b');
    press(list.editor, 'Shift-Tab'); expect(list.changes.at(-1)).toBe('- a\n- b');
    caretIn(list.editor, 'a');
    expect(press(list.editor, 'Tab')).toBe(false); expect(list.changes.at(-1)).toBe('- a\n- b');
    const prose = field({ 'default-value': 'plain' });
    caretIn(prose.editor, 'plain');
    expect(press(prose.editor, 'Tab')).toBe(false); expect(prose.changes).toEqual([]);
  });
});

describe('what the field kept', () => {
  it('strikes with Mod-Shift-X, sets blocks with Mod-Alt-0..3 and undoes with Mod-Z', () => {
    const { changes, editor } = field({ 'default-value': 'Title' });
    editor.commands.focus('end'); editor.commands.selectAll();
    press(editor, 'Mod-Shift-x'); expect(changes.at(-1)).toBe('~~Title~~');
    press(editor, 'Mod-Shift-s'); expect(changes.at(-1)).toBe('~~Title~~');
    press(editor, 'Mod-Alt-2'); expect(changes.at(-1)).toBe('## ~~Title~~');
    editor.view.dispatch(closeHistory(editor.state.tr)); // as a pause in typing would
    press(editor, 'Mod-Alt-0'); expect(changes.at(-1)).toBe('~~Title~~');
    press(editor, 'Mod-z'); expect(changes.at(-1)).toBe('## ~~Title~~');
    press(editor, 'Shift-Mod-z'); expect(changes.at(-1)).toBe('~~Title~~');
  });
  it('breaks a line with Shift-Enter, in a paragraph and in a table cell', () => {
    const { changes, editor } = field({ 'default-value': 'ab\n\n| h |\n| --- |\n| cd |' });
    caretIn(editor, 'ab', 1); press(editor, 'Shift-Enter');
    caretIn(editor, 'cd', 1); press(editor, 'Shift-Enter');
    expect(changes.at(-1)).toBe('a\nb\n\n| h |\n| --- |\n| c<br>d |');
  });
  it('keeps safe links on paste, tel: included, and never copies or pastes an unsafe one', () => {
    const { editor, changes } = field({ 'default-value': '' });
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    const html = '<p><a href="javascript:alert(1)">bad</a> <a href="tel:+15551234">call</a> <a href="/docs">docs</a></p>';
    Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => ({ 'text/html': html, 'text/plain': 'bad call docs' } as Record<string, string>)[type] ?? '' } });
    editor.commands.focus('end'); editor.view.dom.dispatchEvent(event);
    expect(changes.at(-1)).toBe('bad [call](tel:+15551234) [docs](/docs)');
    const copied = editor.view.serializeForClipboard(editor.state.doc.slice(0, editor.state.doc.content.size));
    expect([...copied.dom.querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(['tel:+15551234', '/docs']);
  });
  it('applies every toolbar button to the selection', () => {
    // jsdom has no layout; the toolbar's commands scroll the caret into view.
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    const expected: Record<string, string> = { h1: '# Text', h2: '## Text', h3: '### Text', bold: '**Text**', italic: '*Text*', strike: '~~Text~~', code: '`Text`',
      bullet: '- Text', ordered: '1. Text', task: '- [ ] Text', quote: '> Text', 'code-block': '```\nText\n```', rule: '---' };
    const keys = [...field({}).element.querySelectorAll<HTMLButtonElement>('.af-md-toolbar>button[data-key]')].map(item => item.dataset.key!);
    expect(keys).toEqual([...Object.keys(expected), 'table', 'image']);
    for (const [key, value] of Object.entries(expected)) {
      const { changes, editor, button } = field({ 'default-value': 'Text' });
      editor.commands.focus(); editor.commands.selectAll(); button(key).click();
      expect(changes.at(-1), key).toBe(value);
      expect(button(key).getAttribute('aria-pressed'), key).toBe(key === 'rule' ? null : 'true');
    }
  });
  it('leaves Mod-Enter outside code and task items to the page, and Mod-Alt-2 keeps a level 2 heading', () => {
    const { changes, editor } = field({ 'default-value': '## Title' });
    caretIn(editor, 'Title');
    expect(press(editor, 'Mod-Enter')).toBe(false);
    press(editor, 'Mod-Alt-2'); expect(changes).toEqual([]);
    press(editor, 'Mod-Alt-3'); expect(changes).toEqual(['### Title']);
  });
  it('keeps the spaces around pasted text, and takes Shift+Insert as an ordinary paste', () => {
    const { editor, changes } = field({ 'default-value': 'See it' });
    const paste = (text: string) => {
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => (type === 'text/plain' ? text : '') } });
      editor.view.dom.dispatchEvent(event);
    };
    caretIn(editor, ' it'); paste(' and **more**');
    expect(changes.at(-1)).toBe('See and **more** it');
    caretIn(editor, 'See'); paste('So ');
    expect(changes.at(-1)).toBe('So See and **more** it');
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Insert', keyCode: 45, shiftKey: true }));
    editor.commands.focus('end'); paste('\n\n| a |\n| --- |\n| b |');
    expect(changes.at(-1)).toBe('So See and **more** it\n\n| a |\n| --- |\n| b |');
  });
  it('has history, the gap cursor and the drop cursor', () => {
    const names = field({}).editor.extensionManager.extensions.map(extension => extension.name);
    expect(names).toEqual(expect.arrayContaining(['gapCursor', 'dropCursor', 'markdownFieldBehaviour']));
  });
});
