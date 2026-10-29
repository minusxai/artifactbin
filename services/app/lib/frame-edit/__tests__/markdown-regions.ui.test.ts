// The frame's Markdown regions and comment ranges over a mounted Lexical editor (lib/markdown/editor): a comment
// anchors to the visible words of either rendering, and a region keeps its editor through its own source echo.
import { afterEach, describe, expect, it } from 'vitest';
import { $getRoot, $isTextNode } from 'lexical';
import { mountMarkdownEditor, type MarkdownEditor } from '@/lib/markdown/editor';
import { markdownContent } from '@/lib/markdown';
import { parseJsx, serializeJsx } from '@/lib/jsx';
import { describeRange, resolveParts } from '../selection-range';
import { createMarkdownRegions } from '../markdown-regions';

const mounted: MarkdownEditor[] = [];
afterEach(() => { mounted.splice(0).forEach(editor => editor.destroy()); document.body.innerHTML = ''; });
function mount(source: string) {
  const root = document.createElement('div'); document.body.append(root);
  const changes: string[] = [];
  const view = mountMarkdownEditor(root, { source, onError: message => { throw new Error(message); }, onChange: value => changes.push(value) }); mounted.push(view);
  return { root, changes, view };
}
describe('Markdown regions in the frame', () => {
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
