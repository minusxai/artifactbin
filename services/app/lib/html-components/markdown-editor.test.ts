// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { editorSchema, normalizeMarkdown, parseMarkdown, serializeMarkdown } from './markdown-editor-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { editorPlugins } from './markdown-editor-commands';
import './markdown-editor';

afterEach(() => document.body.replaceChildren());
type Editor = HTMLElement & { value: string | null };
const editor = (markup: string) => { const host = document.createElement('div'); host.innerHTML = markup; document.body.append(host); return host.querySelector('af-markdown-editor') as Editor; };
const editable = (root: Element) => root.querySelector<HTMLElement>('.af-md-editable')!;
const press = (root: Element, key: string) => root.querySelector<HTMLButtonElement>(`button[data-key="${key}"]`)!.click();
/** Select the whole text of the first block, as a person dragging across it would. */
const selectFirstBlock = (root: Element) => {
  editable(root).focus(); const text = editable(root).firstElementChild!.firstChild!; const range = document.createRange();
  range.setStart(text, 0); range.setEnd(text, text.textContent!.length);
  const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
};

describe('markdown-editor model', () => {
  it('round-trips the supported vocabulary, strikethrough included', () => {
    const source = '# Title\n\n## Sub\n\n**bold** *em* ~~gone~~ `code` [site](https://x.dev)\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n```sql\nselect 1\n```\n\n---\n\nend';
    expect(serializeMarkdown(parseMarkdown(source))).toBe(source);
  });
  it('keeps images and HTML as literal text and normalizes spelling, not content', () => {
    expect(normalizeMarkdown('![chart](https://x.dev/a.png)')).toBe('\\![chart](https://x.dev/a.png)');
    expect(parseMarkdown('<b>hi</b>').textContent).toBe('<b>hi</b>');
    expect(normalizeMarkdown('_em_ __strong__\n\n* a\n* b')).toBe('*em* **strong**\n\n- a\n- b');
    expect(normalizeMarkdown('')).toBe('');
  });
  it('links only safe targets, from Markdown or pasted HTML', () => {
    const root = editor('<af-markdown-editor default-value="[x](javascript:alert(1)) [y](/ok)"></af-markdown-editor>');
    expect([...editable(root).querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(['/ok']);
    const link = editorSchema.marks.link!.spec.parseDOM![0]!; const anchor = document.createElement('a');
    anchor.setAttribute('href', 'javascript:alert(1)'); expect(link.getAttrs!(anchor as never)).toBe(false);
    anchor.setAttribute('href', 'https://x.dev'); expect(link.getAttrs!(anchor as never)).toEqual({ href: 'https://x.dev', title: null });
  });
});

/** Type `text` (a newline presses Enter) at the end of a field holding `source`, through the editor's typing rules. */
const typed = (source: string, text: string) => {
  const view = new EditorView(document.createElement('div'), { state: EditorState.create({ doc: parseMarkdown(source), plugins: editorPlugins() }) });
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  for (const char of text) {
    if (char === '\n') { view.someProp('handleKeyDown', handle => handle(view, new KeyboardEvent('keydown', { key: 'Enter' }))); continue; }
    const { from, to } = view.state.selection;
    if (!view.someProp('handleTextInput', handle => handle(view, from, to, char, () => view.state.tr.insertText(char, from, to)))) view.dispatch(view.state.tr.insertText(char, from, to));
  }
  const markdown = serializeMarkdown(view.state.doc); view.destroy(); return markdown;
};

it('keeps Control+E for navigation and formats inline code with Mod+Shift+E', () => {
  const view = new EditorView(document.createElement('div'), {
    state: EditorState.create({ doc: parseMarkdown('First\n\nLast'), plugins: editorPlugins() }),
  });
  try {
    const selectFirst = () =>
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
    selectFirst();
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, cancelable: true }));
    expect(view.state.selection.eq(TextSelection.create(view.state.doc, 6))).toBe(true);
    expect(serializeMarkdown(view.state.doc)).toBe('First\n\nLast');
    selectFirst();
    const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
    view.dom.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'E', keyCode: 69, ctrlKey: !mac, metaKey: mac, shiftKey: true, cancelable: true,
    }));
    expect(serializeMarkdown(view.state.doc)).toBe('`First`\n\nLast');
  } finally {
    view.destroy();
  }
});

describe('markdown-editor typing rules', () => {
  it('turns typed Markdown into formatting', () => {
    expect(typed('', '## Title')).toBe('## Title');
    expect(typed('', '- item')).toBe('- item');
    expect(typed('', '- one\ntwo')).toBe('- one\n- two');
    expect(typed('', '1. item')).toBe('1. item');
    expect(typed('', 'a **b** ~~c~~ *d* `e`')).toBe('a **b** ~~c~~ *d* `e`');
  });
  it('leaves underscores and stars alone inside an open code span', () => {
    expect(typed('', 'use `_views.monthly_revenue`')).toBe('use `_views.monthly_revenue`');
    expect(typed('', '`a*b*c`')).toBe('`a*b*c`');
  });
});

describe('af-markdown-editor', () => {
  it('reads authored text as the initial Markdown and draws it as rich text with a label', () => {
    const root = editor('<af-markdown-editor label="Notes"># Revenue\n\nNet of **discounts**.</af-markdown-editor>');
    expect(editable(root).querySelector('h1')?.textContent).toBe('Revenue');
    expect(editable(root).querySelector('strong')?.textContent).toBe('discounts');
    expect(root.value).toBe('# Revenue\n\nNet of **discounts**.');
    expect(root.querySelector('label')!.textContent).toBe('Notes');
    expect(editable(root).getAttribute('aria-labelledby')).toBe(root.querySelector('label')!.id);
    expect(editable(root).getAttribute('role')).toBe('textbox');
  });
  it('applies toolbar formatting and emits the Markdown as af-change', () => {
    const root = editor('<af-markdown-editor default-value="Revenue"></af-markdown-editor>');
    const events: unknown[] = []; root.addEventListener('af-change', event => events.push((event as CustomEvent).detail));
    selectFirstBlock(root); press(root, 'bold');
    expect(events.at(-1)).toEqual({ value: '**Revenue**' });
    expect(root.querySelector('button[data-key=bold]')!.getAttribute('aria-pressed')).toBe('true');
    press(root, 'strike'); expect(events.at(-1)).toEqual({ value: '**~~Revenue~~**' });
    press(root, 'h2'); expect(events.at(-1)).toEqual({ value: '## **~~Revenue~~**' });
    expect(root.value).toBe('## **~~Revenue~~**');
  });
  it('follows a controlled value and restores it when the change is not reflected back', () => {
    const root = editor('<af-markdown-editor value="before"></af-markdown-editor>');
    selectFirstBlock(root); press(root, 'italic');
    expect(editable(root).querySelector('em')).toBeNull(); expect(root.value).toBe('before');
    root.addEventListener('af-change', event => root.setAttribute('value', (event as CustomEvent).detail.value));
    selectFirstBlock(root); press(root, 'italic');
    expect(editable(root).querySelector('em')?.textContent).toBe('before'); expect(root.value).toBe('*before*');
    root.setAttribute('value', '- server'); expect(editable(root).querySelector('ul li')?.textContent).toBe('server');
    root.setAttribute('value', '- server '); expect(root.querySelector('ul li')?.textContent).toBe('server');
  });
  it('takes a value property over the attribute and reports an empty field as null', () => {
    const root = editor('<af-markdown-editor value="attribute"></af-markdown-editor>');
    root.value = 'property'; expect(editable(root).textContent).toBe('property');
    root.value = ''; expect(editable(root).hasAttribute('data-empty')).toBe(true); expect(root.value).toBeNull();
  });
  it('restores the accepted text when an uncontrolled change is canceled', () => {
    const root = editor('<af-markdown-editor default-value="keep"></af-markdown-editor>');
    root.addEventListener('af-change', event => event.preventDefault());
    selectFirstBlock(root); press(root, 'code');
    expect(editable(root).querySelector('code')).toBeNull(); expect(root.value).toBe('keep');
  });
  it('is not editable while disabled or read only, and shows the placeholder when empty', () => {
    const root = editor('<af-markdown-editor readonly placeholder="Write…" rows="6"></af-markdown-editor>');
    expect(editable(root).getAttribute('contenteditable')).toBe('false');
    expect(editable(root).getAttribute('aria-readonly')).toBe('true');
    expect(editable(root).dataset.placeholder).toBe('Write…'); expect(editable(root).hasAttribute('data-empty')).toBe(true);
    expect(editable(root).style.getPropertyValue('--af-md-rows')).toBe('6');
    expect(root.querySelector<HTMLButtonElement>('button[data-key=bold]')!.disabled).toBe(true);
    root.removeAttribute('readonly'); expect(editable(root).getAttribute('contenteditable')).toBe('true');
    root.setAttribute('disabled', ''); expect(editable(root).getAttribute('aria-disabled')).toBe('true');
  });
  it('names the field from aria-label without a visible label', () => {
    const root = editor('<af-markdown-editor aria-label="Definition"></af-markdown-editor>');
    expect(root.hasAttribute('aria-label')).toBe(false); expect(editable(root).getAttribute('aria-label')).toBe('Definition');
    expect(root.querySelector('label')!.hidden).toBe(true);
  });
});
