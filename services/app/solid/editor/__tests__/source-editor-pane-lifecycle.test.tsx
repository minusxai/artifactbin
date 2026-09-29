/* @jsxImportSource solid-js */
import { expect, it } from 'vitest';
import { waitFor } from '@testing-library/dom';
import { createSignal } from 'solid-js';
import { EditorView } from '@codemirror/view';
import { render } from '@/solid/__tests__/helpers';
import SourceEditorPane from '../SourceEditorPane';
import SourceEditor from '../SourceEditor';
import { SourceEditorToolsProvider } from '../source-editor-tools';

it('keeps the CodeMirror view when an external revision replaces source', async () => {
  const [draft, setDraft] = createSignal({ value: '<p>First</p>', revision: 0 });
  const view = render(() => <SourceEditorPane value={draft().value} revision={draft().revision} onChange={() => {}} />);
  const current = () => EditorView.findFromDOM(view.getByRole('textbox', { name: 'Markup source' }).closest('.cm-editor') as HTMLElement)!;
  await waitFor(() => expect(view.container.querySelector('.cm-editor')).not.toBeNull());
  const first = current();
  setDraft({ value: '<p>Remote</p>', revision: 1 });
  expect(current().state.doc.toString()).toBe('<p>Remote</p>');
  expect(current() === first).toBe(true);
});

it('offers editable complete source while the rich editor chunk is delayed', async () => {
  let release!: (value: { default: typeof SourceEditor }) => void;
  const loading = new Promise<{ default: typeof SourceEditor }>((resolve) => { release = resolve; });
  const [draft, setDraft] = createSignal('<p>First</p>');
  const view = render(() => <SourceEditorToolsProvider value={{ editor: () => loading, formatter: async () => ({ formatJsxPreview: async (source) => source }), formatterUnavailable: null }}>
    <SourceEditorPane value={draft()} revision={0} onChange={setDraft} />
  </SourceEditorToolsProvider>);
  const plain = await view.findByRole('textbox', { name: 'Markup source' });
  expect(plain.tagName).toBe('TEXTAREA');
  expect((plain as HTMLTextAreaElement).value).toBe('<p>First</p>');
  (plain as HTMLTextAreaElement).value = '<p>Updated</p>';
  (plain as HTMLTextAreaElement).setSelectionRange(14, 14);
  plain.dispatchEvent(new Event('input', { bubbles: true }));
  expect(draft()).toBe('<p>Updated</p>');
  release({ default: SourceEditor });
  await waitFor(() => expect(view.container.querySelector('.cm-editor')).not.toBeNull());
  const rich = EditorView.findFromDOM(view.container.querySelector('.cm-editor') as HTMLElement)!;
  expect(rich.state.doc.toString()).toBe('<p>Updated</p>');
  expect(rich.state.selection.main.anchor).toBe(14);
});
