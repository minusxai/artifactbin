import { TextSelection } from 'prosemirror-state';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { parseJsx, serializeJsx } from '@/lib/jsx';
import { FlowEditor } from '../flow-editor';
function nodes(source: string) {
  const p = parseJsx(source);
  if (!p.ok) throw Error(p.error);
  return p.nodes;
}
describe('mounted editor flow', () => {
  it('creates one editable root for adjacent source paragraphs and commits one paste transaction', () => {
    const onChange = vi.fn();
    const view = render(
      <FlowEditor nodes={nodes('<p id="a">alpha</p><p id="b">bravo</p>')} path="0.0" onChange={onChange} />,
    );
    const editor = view.getByRole('textbox');
    expect(view.container.querySelectorAll('[contenteditable="true"]')).toHaveLength(1);
    expect(editor.querySelectorAll('p')).toHaveLength(2);
    fireEvent.focus(editor);
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => (type === 'text/html' ? '<p class="bad"><strong>paste</strong></p>' : 'paste'),
        files: [],
      },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(serializeJsx(onChange.mock.calls[0][0])).toMatch(/<strong[^>]*>paste<\/strong>/);
    expect(serializeJsx(onChange.mock.calls[0][0])).not.toContain('bad');
  });
  it('retains the editor DOM and selection on an unchanged source echo', () => {
    const initial = nodes('<p id="a">alpha</p><p id="b">bravo</p>');
    const onChange = vi.fn();
    const view = render(<FlowEditor nodes={initial} path="0.0" onChange={onChange} />);
    const editor = view.getByRole('textbox');
    view.rerender(<FlowEditor nodes={nodes(serializeJsx(initial))} path="0.0" onChange={onChange} />);
    expect(view.getByRole('textbox')).toBe(editor);
    expect(onChange).not.toHaveBeenCalled();
  });
});

it('keeps paragraph DOM when a changed document is echoed after persistence', () => {
  const view = render(
    <FlowEditor nodes={nodes('<p id="a">alpha</p><p id="b">bravo</p>')} path="0" onChange={() => {}} />,
  );
  const first = view.container.querySelector('#a'),
    second = view.container.querySelector('#b');
  view.rerender(
    <FlowEditor nodes={nodes('<p id="a">changed alpha</p><p id="b">bravo</p>')} path="0" onChange={() => {}} />,
  );
  expect(view.container.querySelector('#a')).toBe(first);
  expect(view.container.querySelector('#b')).toBe(second);
});

it('does not replace a paragraph when selection chrome changes its runtime attributes', async () => {
  const view = render(<FlowEditor nodes={nodes('<p id="a">alpha</p>')} path="0" onChange={() => {}} />);
  const p = view.container.querySelector('p')!;
  p.setAttribute('data-mx-selected', '');
  await new Promise((r) => setTimeout(r, 100));
  expect(view.container.querySelector('p')).toBe(p);
});

it('keeps code paste literal even when clipboard HTML has rich structure', () => {
  const onChange = vi.fn();
  const view = render(<FlowEditor nodes={nodes('<pre id="code">alpha</pre>')} path="0" onChange={onChange} />);
  fireEvent.paste(view.getByRole('textbox'), {
    clipboardData: {
      files: [],
      getData: (type: string) => (type === 'text/html' ? '<strong>bold</strong>' : '**bold**'),
    },
  });
  expect(serializeJsx(onChange.mock.calls[0][0])).toContain('**bold**');
  expect(serializeJsx(onChange.mock.calls[0][0])).not.toContain('<strong');
});

it('refuses destructive replacement across table cells while allowing a cell edit', () => {
  let engine: import('prosemirror-view').EditorView | null = null;
  const onChange = vi.fn(),
    onError = vi.fn();
  render(
    <FlowEditor
      nodes={nodes(
        '<table><tbody><tr><td><p id="left">left</p></td><td><p id="right">right</p></td></tr></tbody></table>',
      )}
      path="0"
      onChange={onChange}
      onError={onError}
      onView={(v) => {
        engine = v;
      }}
    />,
  );
  const v = engine!;
  const positions: number[] = [];
  v.state.doc.descendants((n, p) => {
    if (n.isTextblock) positions.push(p + 1);
  });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, positions[0] + 1, positions[1] + 2)));
  v.dispatch(v.state.tr.insertText('replacement'));
  expect(onChange).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalled();
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, positions[0] + 1)));
  v.dispatch(v.state.tr.insertText('X'));
  expect(serializeJsx(onChange.mock.calls[0][0])).toContain('lXeft');
});

it('pairs view disposal with its registration when callback props change', () => {
  const registered = vi.fn(),
    later = vi.fn(),
    initial = nodes('<p id="p">text</p>');
  const v = render(<FlowEditor nodes={initial} path="0" onChange={() => {}} onView={registered} />);
  v.rerender(<FlowEditor nodes={initial} path="0" onChange={() => {}} onView={later} />);
  v.unmount();
  expect(registered).toHaveBeenLastCalledWith(null);
});

it('does not start a native HTML drag when adjusting selected text', () => {
  const onChange = vi.fn();
  const view = render(<FlowEditor nodes={nodes('<p id="a">alpha</p>')} path="0" onChange={onChange} />);
  expect(fireEvent.dragStart(view.container.querySelector('p')!)).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
});


it('refreshes source paths when whitespace normalizes or the prose region moves', () => {
  const onChange = vi.fn();
  const view = render(<FlowEditor nodes={nodes('<h1>Title</h1>\n<p>Body</p>')} path="0.1" onChange={onChange} />);
  const paragraph = view.container.querySelector('p')!;
  expect(paragraph).toHaveAttribute('data-mx-ast', '0.3');
  view.rerender(<FlowEditor nodes={nodes('<h1>Title</h1><p>Body</p>')} path="0.1" onChange={onChange} />);
  expect(view.container.querySelector('p')).toBe(paragraph);
  expect(paragraph).toHaveAttribute('data-mx-ast', '0.2');
  view.rerender(<FlowEditor nodes={nodes('<h1>Title</h1><p>Body</p>')} path="0.4" onChange={onChange} />);
  expect(paragraph).toHaveAttribute('data-mx-ast', '0.5');
  expect(onChange).not.toHaveBeenCalled();
});
