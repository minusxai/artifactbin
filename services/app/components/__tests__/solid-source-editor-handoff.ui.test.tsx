import { expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import SourceEditor from '@/solid/editor/SourceEditor';

const delayed = vi.hoisted(() => {
  let resolve!: (module: unknown) => void;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
});
vi.mock('@/solid/editor/source-editor-tools', () => ({
  useSourceEditorTools: () => ({
    editor: () => delayed.promise,
    formatter: async () => ({ formatJsxPreview: async (source: string) => source }),
    formatterUnavailable: null,
  }),
}));
import SolidSourceEditorPane from '../SolidSourceEditorPane';
import { TrustedUi } from '../TrustedUi';

it('hands edits made in the plain fallback through the React bridge to CodeMirror', async () => {
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
  let latest = '';
  let remote!: (text: string) => void;
  function Host() {
    const [source, setSource] = useState('<p>Original</p>');
    const [revision, setRevision] = useState(0);
    remote = (text) => { setSource(text); setRevision((value) => value + 1); };
    latest = source;
    return <TrustedUi><SolidSourceEditorPane value={source} revision={revision} onChange={setSource} /></TrustedUi>;
  }
  const view = render(<Host />);
  const shadow = view.container.querySelector<HTMLElement>('[data-trusted-ui]')?.shadowRoot;
  await waitFor(() => expect(shadow?.querySelector('textarea[aria-label="Markup source"]')).not.toBeNull());
  const plain = shadow!.querySelector('textarea[aria-label="Markup source"]') as HTMLTextAreaElement;
  plain.value = '<p>Edited while loading</p>';
  plain.dispatchEvent(new Event('input', { bubbles: true, composed: false }));
  await waitFor(() => expect(latest).toBe('<p>Edited while loading</p>'));
  delayed.resolve({ default: SourceEditor });
  await waitFor(() => expect(shadow?.querySelector('.cm-editor')).not.toBeNull());
  const rich = EditorView.findFromDOM(shadow!.querySelector('.cm-editor') as HTMLElement)!;
  expect(rich.state.doc.toString()).toBe('<p>Edited while loading</p>');
  rich.dispatch({ changes: { from: rich.state.doc.length, insert: ' plus fast typing' } });
  await waitFor(() => expect(latest).toBe('<p>Edited while loading</p> plus fast typing'));
  act(() => remote('<p>Agent wrote while code was open</p>'));
  await waitFor(() => expect(rich.state.doc.toString()).toBe('<p>Agent wrote while code was open</p>'));
  shadow!.querySelector('[aria-label="View formatted"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: false }));
  await waitFor(() => expect(shadow!.textContent).toContain('Formatted preview · read-only'));
  view.unmount();
});
