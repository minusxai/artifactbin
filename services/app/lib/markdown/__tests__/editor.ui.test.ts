import { afterEach, describe, expect, it } from 'vitest';
import { $isListItemNode } from '@lexical/list';
import { $isTableNode, $isTableCellNode, $isTableRowNode } from '@lexical/table';
import { $getRoot, $isTextNode, KEY_TAB_COMMAND } from 'lexical';
import { mountMarkdownEditor, type MarkdownEditor } from '../editor';
import { markdownContent } from '../content';
import { describeRange, resolveParts } from '@/lib/story-runtime/edit/selection-range';
import { createMarkdownRegions } from '@/lib/story-runtime/edit/markdown-regions';
import { parseJsx, serializeJsx } from '@/lib/jsx';

const mounted: MarkdownEditor[] = [];
afterEach(() => { mounted.splice(0).forEach(editor => editor.destroy()); document.body.innerHTML = ''; });
function mount(source: string) {
  const root = document.createElement('div'); document.body.append(root);
  const changes: string[] = [];
  const view = mountMarkdownEditor(root, { source, onError: message => { throw new Error(message); }, onChange: value => changes.push(value) }); mounted.push(view);
  return { root, changes, view };
}
describe('Lexical Markdown region', () => {
  it('edits and formats selected text, persists Markdown, and reopens it', () => {
    const { root, changes, view } = mount('## Overview\n\nHello world');
    expect(root.querySelector('h2')?.textContent).toBe('Overview');
    view.editor.update(() => {
      const text = $getRoot().getLastDescendant();
      if (!$isTextNode(text)) throw new Error('text');
      text.select(6, 11);
    }, { discrete: true });
    view.inline('strong'); view.flush();
    expect(changes.at(-1)).toContain('**world**');
    const reopened = mount(changes.at(-1)!);
    expect(reopened.root.textContent).toBe(root.textContent);
    expect(markdownContent(changes.at(-1)!).errors).toEqual([]);
  });
  it('reports the selected block to the toolbar as the caret moves and formatting changes', () => {
    const { view } = mount('## Decisions\n\nAn ordinary paragraph.\n\n- A list item\n\n> A quotation\n\n```\ncode\n```');
    const selectText = (value: string) => view.editor.update(() => {
      const text = $getRoot().getAllTextNodes().find(node => node.getTextContent() === value);
      if (!text) throw new Error(`Missing text: ${value}`);
      text.select(0, text.getTextContentSize());
    }, { discrete: true });
    for (const [text, block] of [['Decisions', 'h2'], ['An ordinary paragraph.', 'paragraph'], ['A list item', 'bullet'], ['A quotation', 'quote'], ['code', 'code']]) {
      selectText(text);
      expect(view.selection()).toMatchObject({ block });
    }
    selectText('Decisions');
    view.block('h3');
    expect(view.selection()).toMatchObject({ block: 'h3' });
    view.block('number');
    expect(view.selection()).toMatchObject({ block: 'number' });
  });
  it('reports mixed block styles for a selection spanning a heading and paragraph', () => {
    const { view } = mount('## Decisions\n\nDetails');
    view.editor.update(() => {
      const [first, last] = $getRoot().getAllTextNodes();
      first.select(0, 0).setTextNodeRange(first, 0, last, last.getTextContentSize());
    }, { discrete: true });
    expect(view.selection()).toMatchObject({ block: 'mixed' });
  });
  it('edits checklist state, dividers and table cells and reopens their Markdown', () => {
    const source = '- [ ] Open task\n- [x] Done task\n\n---\n\n| Name | Value |\n| :--- | ---: |\n| **Total** | 42 |';
    const { view, root, changes } = mount(source);
    expect(root.querySelectorAll('[role="checkbox"]')).toHaveLength(2);
    expect(root.querySelectorAll('hr')).toHaveLength(1);
    expect(root.querySelectorAll('table')).toHaveLength(1);
    view.editor.update(() => {
      const task = $getRoot().getAllTextNodes().find(node => node.getTextContent() === 'Open task')?.getParent();
      if (!$isListItemNode(task)) throw new Error('checklist item');
      task.setChecked(true);
      const value = $getRoot().getAllTextNodes().find(node => node.getTextContent() === '42');
      if (!value) throw new Error('table value');
      value.setTextContent('43');
    }, { discrete: true });
    view.flush();
    const saved = changes.at(-1)!;
    expect(saved).toContain('[x] Open task');
    expect(saved).toContain('---');
    expect(saved).toContain('43');
    expect(saved).toContain('**Total**');
    expect(markdownContent(saved).errors).toEqual([]);
    const reopened = mount(saved);
    expect(reopened.root.querySelectorAll('[aria-checked="true"]')).toHaveLength(2);
    expect(reopened.root.querySelectorAll('hr')).toHaveLength(1);
    expect(reopened.root.querySelector('table')?.textContent).toBe('NameValueTotal43');
    reopened.view.editor.getEditorState().read(() => {
      const table = $getRoot().getChildren().find($isTableNode)!;
      const cell = table.getChildren().find($isTableRowNode)!.getChildren()[1];
      expect($isTableCellNode(cell) && cell.getFormatType()).toBe('right');
    });
  });
  it('inserts checklists, dividers and tables and changes table dimensions', () => {
    const { view, root, changes } = mount('Task');
    view.editor.update(() => $getRoot().selectEnd(), { discrete: true });
    view.block('check'); view.flush();
    expect(changes.at(-1)).toContain('- [ ] Task');
    view.sync('Paragraph');
    view.editor.update(() => $getRoot().selectEnd(), { discrete: true });
    view.block('hr'); view.flush();
    expect(root.querySelector('hr')).not.toBeNull();
    expect(changes.at(-1)).toContain('---');
    view.sync('');
    view.editor.update(() => $getRoot().selectEnd(), { discrete: true });
    view.block('table'); view.flush();
    expect(root.querySelectorAll('tr')).toHaveLength(3);
    expect(root.querySelectorAll('th')).toHaveLength(2);
    expect(view.selection().block).toBe('table');
    view.table('row-after'); view.table('column-after'); view.flush();
    expect(root.querySelectorAll('tr')).toHaveLength(4);
    expect(root.querySelectorAll('th')).toHaveLength(3);
    view.table('delete-row'); view.table('delete-column'); view.flush();
    expect(root.querySelectorAll('tr')).toHaveLength(3);
    expect(root.querySelectorAll('th')).toHaveLength(2);
    expect(markdownContent(changes.at(-1)!).errors).toEqual([]);
  });

  it('preserves escaped pipes, code, links and line breaks in table cells', () => {
    const source = '| Name | Notes |\n| --- | --- |\n| A\\|B | **bold** and `x|y`<br>[link](https://example.com) |';
    // Pipes in inline code must also be escaped in GFM tables.
    const { view, root, changes } = mount(source.replace('x|y', 'x\\|y'));
    view.editor.update(() => {
      const text = $getRoot().getAllTextNodes().find(node => node.getTextContent() === 'A|B');
      if (!text) throw new Error('pipe text');
      text.setTextContent('C|D');
    }, { discrete: true });
    view.flush();
    const saved = changes.at(-1)!;
    const reopened = mount(saved);
    expect(reopened.root.querySelector('table')?.textContent).toBe(root.querySelector('table')?.textContent);
    expect(reopened.root.querySelector('td br')).not.toBeNull();
    expect(markdownContent(saved).errors).toEqual([]);
  });
  it.each(['- ', '1. ', '- [ ] '])('Tab indents and Shift+Tab outdents Markdown %s lists', marker => {
    const { view, root, changes } = mount(`${marker}Alpha\n${marker}Beta`);
    view.editor.update(() => $getRoot().getAllTextNodes().find(node => node.getTextContent() === 'Beta')!.selectEnd(), { discrete: true });
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    view.editor.update(() => { view.editor.dispatchCommand(KEY_TAB_COMMAND, tab); }, { discrete: true });
    view.flush();
    expect(tab.defaultPrevented).toBe(true);
    expect(root.querySelector('li li')?.textContent).toBe('Beta');
    expect(mount(changes.at(-1)!).root.querySelector('li li')?.textContent).toBe('Beta');
    const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
    view.editor.update(() => { view.editor.dispatchCommand(KEY_TAB_COMMAND, shiftTab); }, { discrete: true });
    view.flush();
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(root.querySelector('li li')).toBeNull();
    expect(root.querySelectorAll('li')).toHaveLength(2);
  });

  it('does not normalize source on mount or reset the caret on its own save echo', () => {
    const source = '# Title\n\nA *word*.';
    const { view, changes, root } = mount(source);
    const paragraph = root.querySelector('p');
    view.sync(source); view.flush();
    expect(changes).toEqual([]);
    expect(root.querySelector('p')).toBe(paragraph);
  });
  it('applies block commands and source history without losing the editor instance', () => {
    const { view, root, changes } = mount('One');
    view.editor.update(() => { $getRoot().selectEnd(); }, { discrete: true });
    view.block('h2'); view.flush();
    expect(changes.at(-1)).toBe('## One');
    view.sync('One');
    expect(root.querySelector('h2')).toBeNull();
    expect(root.querySelector('p')?.textContent).toBe('One');
  });
  it('anchors comments to visible text across Lexical and compiled Markdown, including repeated words', () => {
    const { root, view, changes } = mount('First word, second **word**.'); root.dataset.mxMarkdown = '';
    const texts: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
    const bold = texts.find(text => text.textContent === 'word')!;
    const range = document.createRange(); range.setStart(bold, 0); range.setEnd(bold, 4);
    const comment = describeRange(range, root);
    expect(comment).not.toBeNull();
    expect(comment!.range.parts).toEqual([{ rel: '', text: 'word', start: 19, end: 23 }]);
    const reader = document.createElement('div'); reader.innerHTML = markdownContent('First word, second **word**.').html;
    const highlight = resolveParts(reader, comment!.range.parts);
    expect(highlight[0].toString()).toBe('word');
    expect(highlight[0].startContainer.parentElement?.tagName).toBe('STRONG');
    view.flush(); expect(changes).toEqual([]);
  });
  it('keeps the mounted editor and caret through its own source echo', () => {
    const root = document.createElement('div'); document.body.append(root);
    root.innerHTML = '<div id="body" data-mx-markdown data-mx-ast="0"><p>Hello</p></div>';
    const parse = (source: string) => { const parsed = parseJsx(source); if (!parsed.ok) throw new Error('parse'); return parsed.nodes; };
    const before = parse('<Markdown id="body">{"Hello"}</Markdown>');
    let saved = '';
    const regions = createMarkdownRegions(root, { change(_path, _expected, replacement) { saved = replacement; }, busy() {}, selection() {}, error(message) { throw new Error(message); } });
    regions.mount(before);
    const view = regions.at('0')!;
    view.editor.update(() => { const text = $getRoot().getLastDescendant(); if (!$isTextNode(text)) throw new Error('text'); text.select(5, 5).insertText(' world'); }, { discrete: true });
    regions.flush();
    const after = parse(saved);
    expect(serializeJsx(after)).toContain('Hello world');
    expect(regions.reconcile(before, after, after)).toBe(true);
    expect(regions.at('0')).toBe(view);
    expect(root.textContent).toBe('Hello world');
    regions.destroy();
  });
});
