import { afterEach, expect, it, vi } from 'vitest';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { $getSelection, $isRangeSelection } from 'lexical';
import { mountMarkdownEditor } from '@/lib/markdown/editor';
import { createHoverSelect } from '../hover-select';

afterEach(() => { document.body.replaceChildren(); });

/**
 * A script (or select-all) selects a block's whole contents: the selection is anchored on the block ELEMENT, not on
 * text inside it. The block is what is selected — taking the anchor's parent named the region's container, so the
 * format toolbar lost the block and its inline controls (app-flows: "Toggle italic" after a font-size step).
 */
it('reports the block whose whole contents are selected, not its container', () => {
  const nodes = parseJsxOrThrow('<div>\n<h1 className="text-5xl">Gate doc</h1>\n<p>Total</p>\n</div>').nodes;
  const root = document.createElement('div');
  root.innerHTML = '<div data-mx-ast="0"><div class="ProseMirror" contenteditable="true"><h1 data-mx-ast="0.1" class="text-5xl">Gate doc</h1><p data-mx-ast="0.3">Total</p></div></div>';
  document.body.append(root);
  const post = vi.fn();
  const hover = createHoverSelect({ win: window, root, nodes: () => nodes, views: { all: new Set(), last: null }, activePath: () => null, commitActive() {}, post });
  const range = document.createRange();
  range.selectNodeContents(root.querySelector('h1')!);
  getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  const reported = post.mock.calls.map(([message]) => message.selection).filter(Boolean).at(-1);
  expect(reported).toMatchObject({ path: '0.1', tag: 'h1' });
  // A caret in text still names the text's block.
  range.setStart(root.querySelector('p')!.firstChild!, 2); range.collapse(true);
  getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  expect(post.mock.calls.map(([message]) => message.selection).filter(Boolean).at(-1)).toMatchObject({ path: '0.3', tag: 'p' });
  hover.dispose();
});

it('starts a text selection in a newly inserted Markdown region when requested', async () => {
  const nodes = parseJsxOrThrow('<Markdown id="New1">{""}</Markdown>').nodes;
  const root = document.createElement('div');
  root.innerHTML = '<div id="New1" data-mx-ast="0" data-mx-markdown></div>';
  document.body.append(root);
  const el = root.firstElementChild as HTMLElement;
  const editor = mountMarkdownEditor(el, { source: '', onChange() {} });
  const hover = createHoverSelect({ win: window, root, nodes: () => nodes, views: { all: new Set(), last: null }, activePath: () => null, commitActive() {}, post() {} });
  hover.select({ type: 'mx:select', path: '0', nodeId: 'New1', reveal: true, focusText: true });
  await vi.waitFor(() => expect(editor.editor.getEditorState().read(() => $isRangeSelection($getSelection()))).toBe(true));
  expect(hover.blockMode()).toBe(false);
  expect(hover.selectedPath()).toBe('0');
  hover.dispose(); editor.destroy();
});
