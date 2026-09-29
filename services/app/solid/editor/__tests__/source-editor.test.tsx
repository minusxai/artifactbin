/* @jsxImportSource solid-js */
/**
 * The Solid SourceEditor over the REAL CodeMirror engine (lib/source-editor/codemirror) in jsdom.
 * No React suite mounts CodeMirror (they mock it with a textarea); these pin the wrapper contract
 * the React component's comment states: typing never writes back into the buffer, an echo of `value`
 * (exact or lagging) is a no-op, only a `revision` bump replaces the buffer, the caret survives that
 * replacement, and the view is destroyed exactly once per mount.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { render } from '@/solid/__tests__/helpers';
import SourceEditor from '../SourceEditor';

afterEach(() => { vi.restoreAllMocks(); });

function mount(initial: string) {
  const [value, setValue] = createSignal(initial);
  const [revision, setRevision] = createSignal(0);
  const [readOnly, setReadOnly] = createSignal(false);
  const changes: string[] = [];
  const view = render(() => <SourceEditor value={value()} revision={revision()} readOnly={readOnly()}
    onChange={(next) => { changes.push(next); setValue(next); }} />);
  const cm = () => EditorView.findFromDOM(view.container.querySelector('.cm-editor') as HTMLElement)!;
  /** What a keystroke does: a user transaction at the caret. */
  const type = (text: string) => { const v = cm(); const at = v.state.selection.main.head; v.dispatch({ changes: { from: at, insert: text }, selection: EditorSelection.cursor(at + text.length), userEvent: 'input.type' }); };
  return { ...view, cm, type, changes, setValue, setRevision, setReadOnly, value };
}

it('mounts the engine with the value and a labelled editable surface', () => {
  const view = mount('<p>Draft</p>');
  expect(view.cm().state.doc.toString()).toBe('<p>Draft</p>');
  expect(view.getByLabelText('Markup source').getAttribute('contenteditable')).toBe('true');
});

it('typing echoes through the parent without writing back into the buffer, even when the echo lags', () => {
  const view = mount('<p>ab</p>');
  view.cm().focus();
  view.cm().dispatch({ selection: EditorSelection.cursor(5) }); // after "ab"
  view.type('c');
  view.type('d');
  expect(view.changes).toEqual(['<p>abc</p>', '<p>abcd</p>']);
  expect(view.value()).toBe('<p>abcd</p>');
  // A render one keystroke behind hands back a STALE string: it must not move the buffer or the caret.
  view.setValue('<p>abc</p>');
  expect(view.cm().state.doc.toString()).toBe('<p>abcd</p>');
  expect(view.cm().state.selection.main.head).toBe(7);
  expect(view.changes).toHaveLength(2);
});

it('a revision bump replaces the buffer while focused, keeps the caret and emits nothing', () => {
  const view = mount('<p id="a">mine</p><p id="b">two</p>');
  view.cm().focus();
  view.cm().dispatch({ selection: EditorSelection.cursor(14) }); // after "mine"
  view.type('!');
  const caret = view.cm().state.selection.main.head;
  // A collaborator changed a later node; the parent announces it.
  view.setValue('<p id="a">mine!</p><p id="b">remote two</p>');
  view.setRevision(1);
  expect(view.cm().state.doc.toString()).toBe('<p id="a">mine!</p><p id="b">remote two</p>');
  expect(view.cm().state.selection.main.head).toBe(caret);
  expect(view.cm().hasFocus).toBe(true);
  expect(view.changes).toEqual(['<p id="a">mine!</p><p id="b">two</p>']);
});

it('destroys the view exactly once on unmount, and remounts once when readOnly changes', () => {
  const destroy = vi.spyOn(EditorView.prototype, 'destroy');
  const view = mount('<p>x</p>');
  const first = view.cm();
  view.setReadOnly(true);
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(view.cm()).not.toBe(first);
  expect(view.cm().state.readOnly).toBe(true);
  expect(view.container.querySelectorAll('.cm-editor')).toHaveLength(1);
  view.unmount();
  expect(destroy).toHaveBeenCalledTimes(2);
  expect(document.querySelector('.cm-editor')).toBeNull();
});
