import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { createSourceView, type SourceView } from '../codemirror';

const opened: SourceView[] = [];
afterEach(() => { opened.splice(0).forEach(view => view.destroy()); document.body.innerHTML = ''; });
function mount(options: Partial<Parameters<typeof createSourceView>[0]> = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const onChange = vi.fn();
  const source = createSourceView({ parent, doc: '<Helmet>\n</Helmet>\n<p>ü</p>', readOnly: false, ariaLabel: 'Document source', selection: null, onChange, ...options });
  opened.push(source);
  const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>('.cm-editor')!)!;
  return { parent, source, view, onChange };
}

describe('createSourceView', () => {
  it('mounts the document with a labelled, editable content area', () => {
    const { parent, view } = mount();
    expect(view.state.doc.toString()).toBe('<Helmet>\n</Helmet>\n<p>ü</p>');
    const content = parent.querySelector('.cm-content')!;
    expect(content.getAttribute('aria-label')).toBe('Document source');
    expect(content.getAttribute('contenteditable')).toBe('true');
  });

  it('reports every change the person makes, as the whole buffer', () => {
    const { view, onChange } = mount();
    view.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' });
    expect(onChange).toHaveBeenLastCalledWith('x<Helmet>\n</Helmet>\n<p>ü</p>');
  });

  it('replaces the buffer from outside without echoing a change, keeping the caret clamped, and outside undo history', () => {
    const { source, view, onChange } = mount({ selection: { start: 20, end: 22 } });
    source.replace('short');
    expect(view.state.doc.toString()).toBe('short');
    expect(onChange).not.toHaveBeenCalled();
    expect([view.state.selection.main.anchor, view.state.selection.main.head]).toEqual([5, 5]);
    source.replace('short');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('places a requested selection on mount and on reveal, clamped to the document', () => {
    const { source, view } = mount({ selection: { start: 3, end: 999 } });
    expect([view.state.selection.main.from, view.state.selection.main.to]).toEqual([3, view.state.doc.length]);
    source.reveal({ start: -4, end: 2 });
    expect([view.state.selection.main.from, view.state.selection.main.to]).toEqual([0, 2]);
  });

  it('is read-only on request: not editable and refuses user edits', () => {
    const { parent, view } = mount({ readOnly: true });
    expect(parent.querySelector('.cm-content')!.getAttribute('contenteditable')).toBe('false');
    expect(view.state.readOnly).toBe(true);
  });

  it('removes the editor from the page when destroyed', () => {
    const { parent, source } = mount();
    source.destroy();
    opened.length = 0;
    expect(parent.querySelector('.cm-editor')).toBeNull();
  });
});
