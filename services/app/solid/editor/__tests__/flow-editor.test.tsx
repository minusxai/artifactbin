/** @jsxImportSource solid-js */
/**
 * services/app/lib/editor-v2/__tests__/flow-editor.ui.test.tsx, PORTED to @solidjs/testing-library
 * against the Solid FlowEditor. Every assertion is the original's; what changes is how a test
 * gives a component NEW PROPS: React's `rerender(<C {...next} />)` becomes a signal the test sets
 * (Solid components run once; there is no re-render to request).
 */
import { TextSelection } from 'prosemirror-state';
import { createSignal } from 'solid-js';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@/solid/__tests__/helpers';
import { parseJsx, serializeJsx, type JsxNode } from '@/lib/jsx';
import { FlowEditor } from '../FlowEditor';

function nodes(source: string) {
  const p = parseJsx(source);
  if (!p.ok) throw Error(p.error);
  return p.nodes;
}
describe('mounted editor flow', () => {
  it('creates one editable root for adjacent source paragraphs and commits one paste transaction', () => {
    const onChange = vi.fn();
    const view = render(() => <FlowEditor nodes={nodes('<p id="a">alpha</p><p id="b">bravo</p>')} path="0.0" onChange={onChange} />);
    const editor = view.getByRole('textbox');
    expect(view.container.querySelectorAll('[contenteditable="true"]')).toHaveLength(1);
    expect(editor.querySelectorAll('p')).toHaveLength(2);
    fireEvent.focus(editor);
    fireEvent.paste(editor, { clipboardData: { getData: (type: string) => (type === 'text/html' ? '<p class="bad"><strong>paste</strong></p>' : 'paste'), files: [] } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(serializeJsx(onChange.mock.calls[0]![0])).toMatch(/<strong[^>]*>paste<\/strong>/);
    expect(serializeJsx(onChange.mock.calls[0]![0])).not.toMatch(/\bclass(?:Name)?=["'][^"']*\bbad\b/);
  });
  it('retains the editor DOM and selection on an unchanged source echo', () => {
    const initial = nodes('<p id="a">alpha</p><p id="b">bravo</p>');
    const onChange = vi.fn();
    const [current, setCurrent] = createSignal<JsxNode[]>(initial);
    const view = render(() => <FlowEditor nodes={current()} path="0.0" onChange={onChange} />);
    const editor = view.getByRole('textbox');
    setCurrent(nodes(serializeJsx(initial)));
    expect(view.getByRole('textbox')).toBe(editor);
    expect(onChange).not.toHaveBeenCalled();
  });
});

it('keeps paragraph DOM when a changed document is echoed after persistence', () => {
  const [current, setCurrent] = createSignal(nodes('<p id="a">alpha</p><p id="b">bravo</p>'));
  const view = render(() => <FlowEditor nodes={current()} path="0" onChange={() => {}} />);
  const first = view.container.querySelector('#a'), second = view.container.querySelector('#b');
  setCurrent(nodes('<p id="a">changed alpha</p><p id="b">bravo</p>'));
  expect(view.container.querySelector('#a')).toBe(first);
  expect(view.container.querySelector('#b')).toBe(second);
  expect(view.container.querySelector('#a')!.textContent).toBe('changed alpha');
});

it('does not replace a paragraph when selection chrome changes its runtime attributes', async () => {
  const view = render(() => <FlowEditor nodes={nodes('<p id="a">alpha</p>')} path="0" onChange={() => {}} />);
  const p = view.container.querySelector('p')!;
  p.setAttribute('data-mx-selected', '');
  await new Promise((r) => setTimeout(r, 100));
  expect(view.container.querySelector('p')).toBe(p);
});

it('keeps code paste literal even when clipboard HTML has rich structure', () => {
  const onChange = vi.fn();
  const view = render(() => <FlowEditor nodes={nodes('<pre id="code">alpha</pre>')} path="0" onChange={onChange} />);
  fireEvent.paste(view.getByRole('textbox'), { clipboardData: { files: [], getData: (type: string) => (type === 'text/html' ? '<strong>bold</strong>' : '**bold**') } });
  expect(serializeJsx(onChange.mock.calls[0]![0])).toContain('**bold**');
  expect(serializeJsx(onChange.mock.calls[0]![0])).not.toContain('<strong');
});

it('refuses destructive replacement across table cells while allowing a cell edit', () => {
  let engine: import('prosemirror-view').EditorView | null = null;
  const onChange = vi.fn(), onError = vi.fn();
  render(() => <FlowEditor nodes={nodes('<table><tbody><tr><td><p id="left">left</p></td><td><p id="right">right</p></td></tr></tbody></table>')}
    path="0" onChange={onChange} onError={onError} onView={(v) => { engine = v; }} />);
  const v = engine!;
  const positions: number[] = [];
  v.state.doc.descendants((n, p) => { if (n.isTextblock) positions.push(p + 1); });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, positions[0]! + 1, positions[1]! + 2)));
  v.dispatch(v.state.tr.insertText('replacement'));
  expect(onChange).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalled();
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, positions[0]! + 1)));
  v.dispatch(v.state.tr.insertText('X'));
  expect(serializeJsx(onChange.mock.calls[0]![0])).toContain('lXeft');
});

it('pairs view disposal with its registration when callback props change', () => {
  const registered = vi.fn(), later = vi.fn(), initial = nodes('<p id="p">text</p>');
  const [onView, setOnView] = createSignal<(v: unknown) => void>(registered);
  const v = render(() => <FlowEditor nodes={initial} path="0" onChange={() => {}} onView={onView()} />);
  setOnView(() => later);
  v.unmount();
  expect(registered).toHaveBeenLastCalledWith(null);
});

it('does not start a native HTML drag when adjusting selected text', () => {
  const onChange = vi.fn();
  const view = render(() => <FlowEditor nodes={nodes('<p id="a">alpha</p>')} path="0" onChange={onChange} />);
  expect(fireEvent.dragStart(view.container.querySelector('p')!)).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
});

it('refreshes source paths when whitespace normalizes or the prose region moves', () => {
  const onChange = vi.fn();
  const [current, setCurrent] = createSignal(nodes('<h1>Title</h1>\n<p>Body</p>'));
  const [path, setPath] = createSignal('0.1');
  const view = render(() => <FlowEditor nodes={current()} path={path()} onChange={onChange} />);
  const paragraph = view.container.querySelector('p')!;
  expect(paragraph).toHaveAttribute('data-mx-ast', '0.3');
  setCurrent(nodes('<h1>Title</h1><p>Body</p>'));
  expect(view.container.querySelector('p')).toBe(paragraph);
  expect(paragraph).toHaveAttribute('data-mx-ast', '0.2');
  setPath('0.4');
  expect(paragraph).toHaveAttribute('data-mx-ast', '0.5');
  expect(onChange).not.toHaveBeenCalled();
});

describe('line-boundary keys', () => {
  const press = (editor: HTMLElement, init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    editor.dispatchEvent(event);
    return event;
  };
  it('moves the caret to the visual line edge with Home/End, extending with Shift', () => {
    const modify = vi.fn();
    const native = Object.assign(window.getSelection()!, { modify });
    const spy = vi.spyOn(window, 'getSelection').mockReturnValue(native);
    const view = render(() => <FlowEditor nodes={nodes('<p id="a">alpha bravo</p>')} path="0" onChange={() => {}} />);
    const editor = view.getByRole('textbox');
    expect(press(editor, { key: 'End' }).defaultPrevented).toBe(true);
    expect(modify).toHaveBeenLastCalledWith('move', 'forward', 'lineboundary');
    expect(press(editor, { key: 'Home', shiftKey: true }).defaultPrevented).toBe(true);
    expect(modify).toHaveBeenLastCalledWith('extend', 'backward', 'lineboundary');
    modify.mockClear();
    for (const init of [{ key: 'End', metaKey: true }, { key: 'Home', ctrlKey: true }, { key: 'ArrowRight' }, { key: 'PageDown' }, { key: 'ArrowDown' }]) {
      expect(press(editor, init).defaultPrevented).toBe(false);
    }
    expect(modify).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
