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
import type { EditorView } from 'prosemirror-view';
import { editorDocument, sourceNodes } from '@/lib/editor-v2/model';
import { FlowEditor } from '../FlowEditor';
import { FLOW_IDLE_MS, flushFlowView } from '@/lib/editor-v2/flow-view';
import { createEditorSource } from '@/solid/editor/create-editor-source';
import { captureBookmark } from '@/lib/editor-v2/bookmark';

function nodes(source: string) {
  const p = parseJsx(source);
  if (!p.ok) throw Error(p.error);
  return p.nodes;
}

it.each(['ul', 'ol'])('Tab and Shift-Tab preserve valid %s nesting through repeated and multilevel indentation', tag => {
  let engine: EditorView | null = null;
  const onChange = vi.fn();
  const original = `<${tag} id="list"><li id="first"><p id="a">A</p></li><li id="second"><p id="b">B</p></li><li id="third"><p id="c">C</p></li></${tag}>`;
  const view = render(() => <FlowEditor nodes={nodes(original)} path="0" onChange={onChange} onView={v => { engine = v; }} />);
  const v = engine!;
  const select = (text: string) => {
    let at = 0;
    v.state.doc.descendants((n, pos) => { if (n.isText && n.text === text) at = pos; });
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
  };
  const key = (shiftKey = false) => fireEvent.keyDown(v.dom, { key: 'Tab', shiftKey });
  const source = () => serializeJsx(sourceNodes(v.state.doc));
  select('B'); key();
  expect(view.container.querySelector(`#first > ${tag} > #second`)).not.toBeNull();
  key(true);
  expect(source()).toBe(original);
  key();
  select('C'); key(); key();
  expect(view.container.querySelector(`#second > ${tag} > #third`)).not.toBeNull();
  key(true); key(true);
  expect(view.container.querySelector('li > li')).toBeNull();
  expect(view.container.querySelector(`#list > #third`)).not.toBeNull();
  expect(onChange).toHaveBeenCalled();
});

it.each(['ul', 'ol'])('leaves the first %s item unchanged and indents/lifts a selected item range', tag => {
  let engine: EditorView | null = null;
  const original = `<${tag} id="list"><li id="first"><p id="a">A</p></li><li id="second"><p id="b">B</p></li><li id="third"><p id="c">C</p></li><li id="last"><p id="d">D</p></li></${tag}>`;
  const view = render(() => <FlowEditor nodes={nodes(original)} path="0" onChange={() => {}} onView={v => { engine = v; }} />);
  const v = engine!, positions = new Map<string, number>();
  v.state.doc.descendants((n, pos) => { if (n.isText) positions.set(n.text!, pos); });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, positions.get('A')!)));
  fireEvent.keyDown(v.dom, { key: 'Tab' });
  expect(serializeJsx(sourceNodes(v.state.doc))).toBe(original);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, positions.get('B')!, positions.get('C')! + 1)));
  fireEvent.keyDown(v.dom, { key: 'Tab' });
  expect(view.container.querySelectorAll(`#first > ${tag} > li`)).toHaveLength(2);
  expect(view.container.querySelector(`#list > #last`)).not.toBeNull();
  fireEvent.keyDown(v.dom, { key: 'Tab', shiftKey: true });
  expect(serializeJsx(sourceNodes(v.state.doc))).toBe(original);
  expect(view.container.querySelector('li > li')).toBeNull();
});

it.each([
  '<p id="destination">before after</p>',
  '<ul id="list"><li id="first"><p id="destination">before after</p></li><li id="last"><p>end</p></li></ul>',
])('inserts an orphan list selection into prose without rejecting it or losing adjacent text: %s', source => {
  let engine: EditorView | null = null;
  const onChange = vi.fn(), onError = vi.fn();
  const view = render(() => <FlowEditor nodes={nodes(source)} path="0" onChange={onChange} onError={onError} onView={v => { engine = v; }} />);
  const v = engine!;
  let at = 0;
  v.state.doc.descendants((n, pos) => { if (n.isText && n.text === 'before after') at = pos + 'before '.length; });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
  fireEvent.paste(v.dom, { clipboardData: { files: [], getData: (type: string) => type === 'text/html' ? '<li id="foreign"><p>B</p></li><li><p>C</p></li>' : 'B\nC' } });
  expect(onError).not.toHaveBeenCalled();
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(v.state.doc.textContent).toContain('before');
  expect(v.state.doc.textContent).toContain('after');
  expect(v.state.doc.textContent).toContain('B');
  expect(v.state.doc.textContent).toContain('C');
  expect(view.container.querySelector('li > li')).toBeNull();
  expect(serializeJsx(sourceNodes(v.state.doc))).not.toContain('foreign');
  expect(() => v.state.doc.check()).not.toThrow();
});

it('pastes block fragments with an outer formatting wrapper through the real insertion handler', () => {
  const onChange = vi.fn(), onError = vi.fn();
  const view = render(() => <FlowEditor nodes={nodes('<p id="destination">after</p>')} path="0" onChange={onChange} onError={onError} />);
  fireEvent.paste(view.getByRole('textbox'), { clipboardData: { files: [], getData: (type: string) => type === 'text/html' ? '<b><p>B</p><ul><li>C</li></ul></b>' : 'B\nC' } });
  expect(onError).not.toHaveBeenCalled();
  expect(onChange).toHaveBeenCalledTimes(1);
  const source = serializeJsx(onChange.mock.calls[0]![0]);
  expect(source).toMatch(/<strong[^>]*>B<\/strong>/);
  expect(source).toMatch(/<strong[^>]*>C<\/strong>/);
  expect(source).toContain('after');
  expect(view.container.querySelector('li > li')).toBeNull();
});

it.each(['single', 'range'])('copies and pastes the editor\'s own nested list %s through the clipboard handlers', kind => {
  let engine: EditorView | null = null;
  const onChange = vi.fn(), onError = vi.fn();
  const source = '<ul id="list"><li id="outer"><p id="a">Alpha</p><ul id="nested"><li id="b"><strong id="bold">Bravo</strong></li><li id="c"><em id="italic">Charlie</em></li></ul></li><li id="last"><p id="d">Delta</p></li></ul>';
  const view = render(() => <FlowEditor nodes={nodes(source)} path="0" onChange={onChange} onError={onError} onView={v => { engine = v; }} />);
  const v = engine!, positions = new Map<string, number>();
  v.state.doc.descendants((n, pos) => { if (n.isText) positions.set(n.text!, pos); });
  const values = new Map<string, string>();
  const clipboardData = {
    files: [], clearData: () => values.clear(),
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? '',
  };
  const end = kind === 'single' ? positions.get('Bravo')! + 'Bravo'.length : positions.get('Charlie')! + 'Charlie'.length;
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, positions.get('Bravo')!, end)));
  fireEvent.copy(v.dom, { clipboardData });
  expect(values.get('text/html')).toContain('data-pm-slice');
  expect(values.get('text/html')).toContain('Bravo');
  v.dispatch(v.state.tr.setSelection(TextSelection.atEnd(v.state.doc)));
  fireEvent.paste(v.dom, { clipboardData });
  expect(onError).not.toHaveBeenCalled();
  expect(onChange).toHaveBeenCalledTimes(1);
  const saved = serializeJsx(sourceNodes(v.state.doc));
  expect(saved.match(/Bravo/g)).toHaveLength(2);
  expect(saved.match(/Charlie/g)).toHaveLength(kind === 'single' ? 1 : 2);
  expect(saved.match(/id="b"/g)).toHaveLength(1);
  expect(saved.match(/id="bold"/g)).toHaveLength(1);
  expect(saved).not.toContain('data-pm-slice');
  expect(view.container.querySelector('li > li')).toBeNull();
  expect(() => v.state.doc.check()).not.toThrow();
  expect(serializeJsx(sourceNodes(editorDocument(nodes(saved))))).toBe(saved);
});
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
  flushFlowView(v);
  expect(serializeJsx(onChange.mock.calls[0]![0])).toContain('lXeft');
});

describe('typing is handed to the page once it pauses', () => {
  it('holds keystrokes ProseMirror has drawn, then hands them over as ONE typing edit with the first and last caret', () => {
    vi.useFakeTimers();
    try {
      let engine: import('prosemirror-view').EditorView | null = null;
      const onChange = vi.fn(), onBusy = vi.fn();
      render(() => <FlowEditor nodes={nodes('<p id="a">alpha</p>')} path="0" onChange={onChange} onBusy={onBusy} onView={(v) => { engine = v; }} />);
      const v = engine!;
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 6)));
      for (const key of ['!', '?', '.']) v.dispatch(v.state.tr.insertText(key));
      // Drawn at once, handed over not yet: the page's whole-document work is off the keystroke's path.
      expect(v.dom.textContent).toBe('alpha!?.');
      expect(onChange).not.toHaveBeenCalled();
      expect(onBusy).toHaveBeenLastCalledWith(true);
      vi.advanceTimersByTime(FLOW_IDLE_MS - 1);
      expect(onChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onChange).toHaveBeenCalledTimes(1);
      const [replacement, group, selection] = onChange.mock.calls[0]!;
      expect(serializeJsx(replacement)).toContain('alpha!?.');
      expect(group).toBe('typing:0');
      expect(selection.before.anchor).toEqual({ id: 'a', offset: 5 });
      expect(selection.after.anchor).toEqual({ id: 'a', offset: 8 });
      expect(onBusy).toHaveBeenLastCalledWith(false);
    } finally { vi.useRealTimers(); }
  });

  it('hands a broken paragraph over at once (Enter), with the typing before it', () => {
    let engine: import('prosemirror-view').EditorView | null = null;
    const onChange = vi.fn();
    render(() => <FlowEditor nodes={nodes('<p id="a">alpha</p>')} path="0" onChange={onChange} onView={(v) => { engine = v; }} />);
    const v = engine!;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 6)).insertText('!'));
    expect(onChange).not.toHaveBeenCalled();
    v.dispatch(v.state.tr.split(v.state.selection.from));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(serializeJsx(onChange.mock.calls[0]![0])).toMatch(/alpha!<\/p><p/);
  });

  it('hands held typing over before a paste, and at once when asked (commit, undo, blur)', () => {
    let engine: import('prosemirror-view').EditorView | null = null;
    const onChange = vi.fn();
    const view = render(() => <FlowEditor nodes={nodes('<p id="a">alpha</p>')} path="0" onChange={onChange} onView={(v) => { engine = v; }} />);
    const v = engine!;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 6)).insertText('1'));
    fireEvent.paste(view.getByRole('textbox'), { clipboardData: { getData: (type: string) => (type === 'text/plain' ? '2' : ''), files: [] } });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[0]![1]).toBe('typing:0');
    expect(serializeJsx(onChange.mock.calls[0]![0])).toContain('alpha1<');
    expect(onChange.mock.calls[1]![1]).toBeUndefined();
    v.dispatch(v.state.tr.insertText('3'));
    flushFlowView(v);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(serializeJsx(onChange.mock.calls[2]![0])).toContain('alpha123');
    flushFlowView(v);
    expect(onChange).toHaveBeenCalledTimes(3);
  });
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

it('keeps the leading space of a one-line plain-text paste, as typing it would', () => {
  let engine: import('prosemirror-view').EditorView | null = null;
  const onChange = vi.fn();
  const view = render(() => <FlowEditor nodes={nodes('<p id="a">alpha</p>')} path="0" onChange={onChange} onView={(v) => { if (v) engine = v; }} />);
  const editor = view.getByRole('textbox');
  fireEvent.focus(editor);
  const end = engine!.state.doc.resolve(1 + 'alpha'.length);
  engine!.dispatch(engine!.state.tr.setSelection(TextSelection.near(end)));
  fireEvent.paste(editor, { clipboardData: { files: [], getData: (type: string) => (type === 'text/plain' ? ' pasted words' : '') } });
  expect(view.container.querySelector('#a')!.textContent).toBe('alpha pasted words');
  expect(serializeJsx(onChange.mock.calls.at(-1)![0])).toContain('alpha pasted words');
});

it('keeps the first line\'s leading and the last line\'s trailing spaces of a multi-line plain-text paste', () => {
  let engine: EditorView | null = null;
  const onChange = vi.fn();
  const view = render(() => <FlowEditor nodes={nodes('<p id="a">alphaomega</p>')} path="0" onChange={onChange} onView={(v) => { if (v) engine = v; }} />);
  const editor = view.getByRole('textbox');
  fireEvent.focus(editor);
  engine!.dispatch(engine!.state.tr.setSelection(TextSelection.create(engine!.state.doc, 1 + 'alpha'.length)));
  fireEvent.paste(editor, { clipboardData: { files: [], getData: (type: string) => (type === 'text/plain' ? ' first\nmiddle\nlast ' : '') } });
  const blocks = [...editor.querySelectorAll('p')].map((p) => p.textContent);
  expect(blocks).toEqual(['alpha first', 'middle', 'last omega']);
  expect(serializeJsx(onChange.mock.calls.at(-1)![0])).toMatch(/alpha first<\/p>.*>last omega<\/p>$/);
});

/** HTML typing stays literal; rich formatting remains an explicit command. */
describe('HTML text editing', () => {
  function editor(source: string) {
    let engine: EditorView | null = null;
    const initial = serializeJsx(nodes(source));
    const store = createEditorSource({ initial, live: { queue: () => {} }, draw: () => {}, commitPending: async () => {} });
    const view = render(() => <FlowEditor nodes={nodes(initial)} path="0" onChange={(next, group, selection) => store.apply(serializeJsx(next), { origin: 'local', group, selection })} onView={(v) => { if (v) engine = v; }} />);
    const v = () => engine!;
    const type = (text: string) => {
      for (const ch of text) {
        const { from, to } = v().state.selection;
        const typing = () => v().state.tr.insertText(ch, from, to);
        if (!v().someProp('handleTextInput', (f) => f(v(), from, to, ch, typing))) v().dispatch(typing());
      }
      // Typing pauses: ProseMirror hands what it drew to the page (FLOW_IDLE_MS).
      flushFlowView(v());
    };
    const enter = () => { v().someProp('handleKeyDown', (f) => f(v(), new KeyboardEvent('keydown', { key: 'Enter' }))); flushFlowView(v()); };
    const caret = (position: 'start' | 'end') => v().dispatch(v().state.tr.setSelection(position === 'start' ? TextSelection.atStart(v().state.doc) : TextSelection.atEnd(v().state.doc)));
    return { view, store, type, enter, caret, v };
  }

  it.each(['# ', '## ', '###### ', '- ', '* ', '1. ', '> ', '[] ', '[x] ', '``` ', '--- ', '**bold**', '*italic*'])('keeps typed %s literal, preserving identity, classes and undo', async text => {
    const e = editor('<p id="a" className="lead"></p>');
    e.type(text);
    expect(e.view.container.querySelector('p#a.lead')?.textContent).toBe(text);
    expect(e.view.container.querySelector('h1,h2,ul,ol,hr,pre,blockquote,strong,em,input')).toBeNull();
    const saved = e.store.current();
    expect(serializeJsx(sourceNodes(editorDocument(nodes(saved))))).toBe(saved);
    await e.store.undo();
    expect(e.store.current()).toBe('<p id="a" className="lead"></p>');
    await e.store.redo();
    expect(e.store.current()).toBe(saved);
  });
  it.each(['---', '```'])('Enter after %s creates an ordinary paragraph', marker => {
    const e = editor('<p id="a"></p>');
    e.type(marker); e.enter(); e.type('Next');
    expect([...e.view.container.querySelectorAll('p')].map(p => p.textContent)).toEqual([marker, 'Next']);
    expect(e.view.container.querySelector('hr,pre')).toBeNull();
  });
  it('continues existing HTML checkboxes and leaves an empty task', () => {
    const e = editor('<p id="task"><input type="checkbox" disabled checked={true} /> Done</p>');
    e.caret('end'); e.enter(); e.type('Next');
    expect((e.view.getAllByRole('checkbox') as HTMLInputElement[]).map(box => box.checked)).toEqual([true, false]);
    e.enter(); e.enter(); e.type('Plain paragraph');
    expect(e.view.getAllByRole('checkbox')).toHaveLength(2);
    expect(e.view.container.querySelector('p:last-child')?.textContent).toBe('Plain paragraph');
  });
  it('keeps newlines in authored code and Mod-Enter leaves it', () => {
    const e = editor('<pre id="code"></pre>');
    e.type('# literal'); e.enter(); e.type('  indented');
    expect(e.store.current()).toBe('<pre id="code"># literal\n  indented</pre>');
    const mac = /Mac/.test(navigator.platform);
    e.v().someProp('handleKeyDown', f => f(e.v(), new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: !mac, metaKey: mac })));
    e.type('After code');
    expect(e.view.container.querySelector('pre + p')?.textContent).toBe('After code');
  });
  it.each(['ul', 'ol'])('continues authored %s items and leaves an empty item', list => {
    const e = editor(`<${list} id="list"><li id="item"><p id="a">one</p></li></${list}>`);
    e.caret('end'); e.enter(); e.type('two'); e.enter(); e.enter(); e.type('after');
    expect(e.view.container.querySelectorAll(`${list} > li`)).toHaveLength(2);
    expect(e.view.container.querySelector(`${list} + p`)?.textContent).toBe('after');
    expect(new Set(e.store.current().match(/id="[^"]+"/g)).size).toBe(e.store.current().match(/id="[^"]+"/g)!.length);
  });
  it('preserves code newlines and indentation when native typing changes the DOM', async () => {
    const e = editor('<pre id="code"># literal\n  codeCode</pre>');
    const text = e.view.container.querySelector('pre')!.firstChild!;
    // Native browser input is read by ProseMirror's mutation observer, unlike command insertion.
    text.nodeValue = '# literal\n  codeXCode';
    await new Promise(resolve => setTimeout(resolve, 0));
    flushFlowView(e.v());
    expect(e.store.current()).toBe('<pre id="code"># literal\n  codeXCode</pre>');
  });

  it('keeps a saved checkbox disabled when prose is not editable', () => {
    const onChange = vi.fn();
    const e = render(() => <FlowEditor nodes={nodes('<p><input type="checkbox" disabled checked={true} /> Done</p>')} path="0" canEdit={() => false} onChange={onChange} />);
    const box = e.getByRole('checkbox') as HTMLInputElement;
    expect(box.disabled).toBe(true);
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

});

describe('selection during collaborative Markdown updates', () => {
  const initial = '<p id="a">alpha</p><p id="b">bravo</p><p id="c">charlie</p>';
  it.each([
    ['insertion above', '<p id="new">a new remote paragraph</p>' + initial],
    ['deletion above', '<p id="b">bravo</p><p id="c">charlie</p>'],
    ['heading conversion above', '<h1 id="a">a much longer remote heading</h1><p id="b">bravo</p><p id="c">charlie</p>'],
    ['block movement', '<p id="c">charlie</p><p id="b">bravo</p><p id="a">alpha</p>'],
    ['active heading conversion', '<p id="a">alpha</p><h2 id="b">bravo</h2><p id="c">charlie</p>'],
  ])('keeps the selected text on its persistent block after remote %s', (_name, remote) => {
    let engine: EditorView | null = null;
    const [current, setCurrent] = createSignal(nodes(initial));
    const onChange = vi.fn();
    render(() => <FlowEditor nodes={current()} path="0" onChange={onChange} onView={v => { if (v) engine = v; }} />);
    const v = engine!;
    // A backwards selection in paragraph b, not a collapsed caret.
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 12, 9)));
    const bookmark = captureBookmark(v.state);
    expect(bookmark).toEqual({ anchor: { id: 'b', offset: 4 }, head: { id: 'b', offset: 1 } });
    setCurrent(nodes(remote));
    expect(captureBookmark(v.state)).toEqual(bookmark);
    expect(onChange).not.toHaveBeenCalled();
    expect(v.state.doc.textContent).toBe(editorDocument(nodes(remote)).textContent);
  });

  it('clamps selection offsets when the remote author shortens the active block', () => {
    let engine: EditorView | null = null;
    const [current, setCurrent] = createSignal(nodes(initial));
    render(() => <FlowEditor nodes={current()} path="0" onChange={() => {}} onView={v => { if (v) engine = v; }} />);
    const v = engine!;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 13, 10)));
    setCurrent(nodes(initial.replace('bravo', 'b')));
    expect(captureBookmark(v.state)).toEqual({ anchor: { id: 'b', offset: 1 }, head: { id: 'b', offset: 1 } });
  });

  it('uses a valid collapsed fallback when the selected block was deleted remotely', () => {
    let engine: EditorView | null = null;
    const [current, setCurrent] = createSignal(nodes(initial));
    const onChange = vi.fn();
    render(() => <FlowEditor nodes={current()} path="0" onChange={onChange} onView={v => { if (v) engine = v; }} />);
    const v = engine!;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 12, 9)));
    setCurrent(nodes('<p id="a">alpha</p><p id="c">charlie</p>'));
    expect(v.state.selection.empty).toBe(true);
    expect(v.state.selection.$from.parent.isTextblock).toBe(true);
    expect(v.state.doc.textContent).toBe('alphacharlie');
    expect(onChange).not.toHaveBeenCalled();
  });

});

describe('document-editor keys: Tab indents, links are typed, pasted and found', () => {
  function editor(source: string) {
    let engine: EditorView | null = null;
    const initial = serializeJsx(nodes(source));
    const store = createEditorSource({ initial, live: { queue: () => {} }, draw: () => {}, commitPending: async () => {} });
    const view = render(() => <FlowEditor nodes={nodes(initial)} path="0" onChange={(next, group, selection) => store.apply(serializeJsx(next), { origin: 'local', group, selection })} onView={(v) => { if (v) engine = v; }} />);
    const v = () => engine!;
    const type = (text: string) => {
      for (const ch of text) {
        const { from, to } = v().state.selection;
        const typing = () => v().state.tr.insertText(ch, from, to);
        if (!v().someProp('handleTextInput', (f) => f(v(), from, to, ch, typing))) v().dispatch(typing());
      }
      flushFlowView(v());
    };
    /** The key as the browser delivers it; true when the editor kept it (default prevented). */
    const key = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
      v().dom.dispatchEvent(event);
      flushFlowView(v());
      return event.defaultPrevented;
    };
    const at = (text: string, offset = 0) => {
      let pos = -1;
      v().state.doc.descendants((n, p) => { if (pos < 0 && n.isText && n.text!.includes(text)) pos = p + n.text!.indexOf(text) + offset; });
      return pos;
    };
    const select = (from: number, to = from) => v().dispatch(v().state.tr.setSelection(TextSelection.create(v().state.doc, from, to)));
    const paste = (plain: string, html = '') => {
      fireEvent.paste(v().dom, { clipboardData: { files: [], getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? plain : '' } });
      flushFlowView(v());
    };
    /** The saved source, without the ids the editor mints for new elements. */
    const saved = () => store.current().replace(/ id="e[0-9a-f]{32}"/g, '');
    return { view, store, saved, type, key, at, select, paste, v };
  }

  it('indents and outdents paragraphs and checklist items a level at a time, keeping Tab in the document', async () => {
    const e = editor('<p id="note">Note</p><p id="task"><input id="box" type="checkbox" aria-label="Task completed" disabled checked={false} /> Task</p>');
    e.select(e.at('Task'));
    expect(e.key({ key: 'Tab' })).toBe(true);
    expect(e.key({ key: 'Tab' })).toBe(true);
    expect(e.store.current()).toContain('<p id="task" className="ml-16">');
    expect(e.view.container.querySelector('#task')?.className).toBe('ml-16');
    expect(e.key({ key: 'Tab', shiftKey: true })).toBe(true);
    expect(e.store.current()).toContain('<p id="task" className="ml-8">');
    // Shift-Tab at the margin is still the document's: focus does not leave.
    e.select(e.at('Note'));
    expect(e.key({ key: 'Tab', shiftKey: true })).toBe(true);
    expect(e.store.current()).toContain('<p id="note">Note</p>');
    // Both paragraphs at once; the checkbox's identity survives.
    e.select(e.at('Note'), e.at('Task', 2));
    e.key({ key: 'Tab' });
    expect(e.store.current()).toContain('<p id="note" className="ml-8">');
    expect(e.store.current()).toContain('<p id="task" className="ml-16"><input id="box"');
    await e.store.undo();
    expect(e.store.current()).toContain('<p id="note">Note</p>');
  });

  it('keeps authored classes, caps the indent, and outdents with Backspace at the start of an indented line', () => {
    const e = editor('<p id="lead" className="text-lg ml-48">Lead</p>');
    e.select(e.at('Lead'));
    e.key({ key: 'Tab' });
    expect(e.store.current()).toContain('className="text-lg ml-48"');
    e.key({ key: 'Backspace' });
    expect(e.store.current()).toContain('<p id="lead" className="text-lg ml-40">Lead</p>');
    // Not at the start: Backspace is the browser's, as always.
    e.select(e.at('Lead', 4));
    expect(e.key({ key: 'Backspace' })).toBe(false);
    expect(e.store.current()).toContain('ml-40">Lead</p>');
  });

  it('indents code lines with spaces and still nests list items', () => {
    const e = editor('<pre id="code">one\ntwo</pre><ul id="list"><li id="a"><p>A</p></li><li id="b"><p>B</p></li></ul>');
    e.select(e.at('one'));
    e.key({ key: 'Tab' });
    expect(e.store.current()).toContain('<pre id="code">  one\ntwo</pre>');
    e.select(e.at('one'), e.at('two', 3));
    e.key({ key: 'Tab' });
    expect(e.store.current()).toContain('<pre id="code">    one\n  two</pre>');
    e.key({ key: 'Tab', shiftKey: true });
    e.key({ key: 'Tab', shiftKey: true });
    expect(e.store.current()).toContain('<pre id="code">one\ntwo</pre>');
    e.select(e.at('B'));
    expect(e.key({ key: 'Tab' })).toBe(true);
    expect(e.view.container.querySelector('#a > ul > #b')).not.toBeNull();
  });

  it('links a typed address when a space or Enter ends it, leaving sentence punctuation and code alone', () => {
    const e = editor('<p id="p"></p>');
    e.type('see www.example.com/docs. ');
    expect(e.view.container.querySelector('a')).toBeNull();
    e.type('and https://example.com/a?b=1 now');
    expect(e.view.container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/a?b=1');
    expect(e.view.container.querySelector('a')?.textContent).toBe('https://example.com/a?b=1');
    // The space after it is not part of the link, nor is what follows.
    expect(e.saved()).toContain('<a href="https://example.com/a?b=1">https://example.com/a?b=1</a> now');
    e.select(e.at('now', 3));
    e.type(' example.org');
    e.key({ key: 'Enter' });
    expect([...e.view.container.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(['https://example.com/a?b=1']);
    const code = editor('<pre id="c"></pre>');
    code.type('https://example.com ');
    expect(code.view.container.querySelector('a')).toBeNull();
    const list = editor('<ul><li><p id="item"></p></li></ul>');
    list.type('www.example.com ');
    expect(list.view.container.querySelector('li a')?.getAttribute('href')).toBe('https://www.example.com');
  });

  it('keeps typed Markdown links literal in HTML', () => {
    const e = editor('<p id="p"></p>');
    e.type('Read [the guide](example.com/guide) first');
    expect(e.saved()).toBe('<p id="p">Read [the guide](example.com/guide) first</p>');
    const unsafe = editor('<p id="p"></p>');
    unsafe.type('[x](javascript:alert(1))');
    expect(unsafe.view.container.querySelector('a')).toBeNull();
  });

  it('links selected words to a pasted address, and pastes a lone address as a link', () => {
    const e = editor('<p id="p">Read the guide</p>');
    e.select(e.at('guide'), e.at('guide', 5));
    e.paste('https://example.com/guide');
    expect(e.saved()).toBe('<p id="p">Read the <a href="https://example.com/guide">guide</a></p>');
    e.select(e.at('Read', 4));
    e.paste(' https://example.org ');
    expect(e.saved()).toContain('Read<a href="https://example.org">https://example.org</a> the');
    // Prose that is not an address pastes as before.
    e.paste('just words');
    expect(e.store.current()).toContain('just words');
  });

  it('finds the whole link at a caret, edits or removes all of it, and inserts the address at a bare caret', async () => {
    const { linkAt, setLink } = await import('@/lib/editor-v2/links');
    const e = editor('<p id="p">Go <a href="https://a.example"><strong>to</strong> here</a> now</p>');
    e.select(e.at(' here', 2));
    expect(linkAt(e.v().state)).toEqual({ href: 'https://a.example', from: e.at('to'), to: e.at(' here', 5) });
    e.v().dispatch(setLink(e.v().state, 'b.example')!);
    flushFlowView(e.v());
    expect(e.saved()).toContain('<a href="https://b.example"><strong>to</strong> here</a>');
    e.v().dispatch(setLink(e.v().state, null)!);
    flushFlowView(e.v());
    expect(e.saved()).toBe('<p id="p">Go <strong>to</strong> here now</p>');
    e.select(e.at('now', 3));
    e.v().dispatch(setLink(e.v().state, 'https://c.example')!);
    flushFlowView(e.v());
    expect(e.saved()).toContain('now<a href="https://c.example">https://c.example</a></p>');
    expect(setLink(e.v().state, 'javascript:alert(1)')).toBeNull();
  });
});
