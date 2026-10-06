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
import { createEditorSource } from '../create-editor-source';

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

/**
 * Markdown block shortcuts, typed through ProseMirror's own text-input path (handleTextInput, then the
 * default insertion), with every change recorded by the real source store, as the page records it.
 */
describe('markdown block shortcuts', () => {
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
  const ID = 'e[0-9a-f]{32}';

  it.each(['space', 'enter'])('inserts a horizontal rule with --- and %s, preserving undo and a place to type', async trigger => {
    const e = editor('<article id="doc"><p id="divider"></p></article>');
    e.type('---');
    if (trigger === 'space') e.type(' '); else e.enter();
    expect(e.view.container.querySelector('article > hr#divider')).not.toBeNull();
    expect(e.view.container.querySelector('hr + p')).not.toBeNull();
    const converted = e.store.current();
    expect(serializeJsx(sourceNodes(editorDocument(nodes(converted))))).toBe(converted);
    await e.store.undo();
    expect(e.store.current()).toBe(`<article id="doc"><p id="divider">---${trigger === 'space' ? ' ' : ''}</p></article>`);
    await e.store.redo();
    expect(e.store.current()).toBe(converted);
    e.type('After the divider');
    expect(e.view.container.querySelector('hr + p')?.textContent).toBe('After the divider');
  });

  it('keeps text after the horizontal-rule marker in the following paragraph', () => {
    const e = editor('<p id="divider">Keep me</p>');
    e.caret('start');
    e.type('--- ');
    expect(e.view.container.querySelector('hr + p')?.textContent).toBe('Keep me');
  });

  it.each(['[] ', '[ ] ', '[x] '])('creates a saved, toggleable checkbox from %s', async prefix => {
    const e = editor('<p id="task"></p>');
    e.type(`${prefix}Ship it`);
    const checkbox = e.view.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(prefix === '[x] ');
    expect(checkbox.disabled).toBe(false);
    const before = e.store.current();
    fireEvent.click(checkbox);
    const saved = e.store.current();
    expect(saved).not.toBe(before);
    expect(e.view.getByRole('checkbox').getAttribute('aria-label')).toBe('Task completed');
    expect(serializeJsx(sourceNodes(editorDocument(nodes(saved))))).toBe(saved);
    expect(saved).toContain('disabled');
    await e.store.undo();
    expect(e.store.current()).toBe(before);
  });

  it('continues checkboxes unchecked on Enter and exits an empty task', () => {
    const e = editor('<p id="task"></p>');
    e.type('[x] Done');
    e.enter();
    e.type('Next');
    const boxes = e.view.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map(box => box.checked)).toEqual([true, false]);
    e.enter();
    e.enter();
    e.type('Plain paragraph');
    expect(e.view.getAllByRole('checkbox')).toHaveLength(2);
    expect(e.view.container.querySelector('p:last-child')?.textContent).toBe('Plain paragraph');
  });

  it.each(['space', 'enter'])('starts a literal code block with a fence and %s', trigger => {
    const e = editor('<p id="code" className="lead"></p>');
    e.type('```');
    if (trigger === 'space') e.type(' '); else e.enter();
    e.type('# literal');
    e.enter();
    e.type('  indented');
    expect(e.store.current()).toBe('<pre id="code"># literal\n  indented</pre>');
    expect(serializeJsx(sourceNodes(editorDocument(nodes(e.store.current()))))).toBe(e.store.current());
    const mac = /Mac/.test(navigator.platform);
    e.v().someProp('handleKeyDown', f => f(e.v(), new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: !mac, metaKey: mac })));
    e.type('After code');
    expect(e.view.container.querySelector('pre + p')?.textContent).toBe('After code');
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

  it('wraps a paragraph in a blockquote and exits an empty quote', () => {
    const e = editor('<p id="quote"></p>');
    e.type('> Quoted');
    expect(e.view.container.querySelector('blockquote > p#quote')?.textContent).toBe('Quoted');
    e.enter();
    e.enter();
    e.type('After quote');
    expect(e.view.container.querySelector('blockquote + p')?.textContent).toBe('After quote');
  });

  it.each(['[] ', '``` ', '> '])('undoes the %s conversion back to its literal marker', async prefix => {
    const e = editor('<p id="a"></p>');
    e.type(prefix);
    await e.store.undo();
    expect(e.store.current()).toBe(`<p id="a">${prefix.replace('>', '&gt;')}</p>`);
  });

  it.each(['[] ', '``` ', '> ', '--- '])('keeps %s literal in code, a cell, and mid-paragraph', prefix => {
    for (const source of ['<pre id="a"></pre>', '<table><tr><td><p id="a"></p></td></tr></table>', '<p id="a">Literal: </p>']) {
      const e = editor(source);
      e.caret('end');
      e.type(prefix);
      expect(e.view.container.querySelector('#a')?.textContent).toContain(prefix);
      expect(e.view.queryByRole('checkbox')).toBeNull();
    }
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

  it('keeps repeated Enter and markdown headings inside the document column', () => {
    const e = editor('<article id="doc" className="max-w-3xl"><h1 id="title">Notes</h1><p id="body">Body</p></article>');
    e.caret('end');
    for (let i = 0; i < 5; i++) e.enter();
    e.type('## Section');
    const saved = nodes(e.store.current());
    expect(saved).toHaveLength(1);
    expect(e.view.container.querySelector('article > h2')?.textContent).toBe('Section');
    e.enter();
    e.type('Following paragraph');
    expect(e.view.container.querySelector('article > h2 + p')?.textContent).toBe('Following paragraph');
  });

  it('keeps the converted heading selectable after the source echoes back', () => {
    // The real mounter echoes saved nodes without replacing a matching engine document.
    const [source, setSource] = createSignal(nodes('<article id="doc"><p id="section"></p></article>'));
    let engine: EditorView | null = null;
    const mounted = render(() => <FlowEditor nodes={source()} path="0" onChange={setSource} onView={v => { if (v) engine = v; }} />);
    const v = engine! as EditorView;
    for (const ch of '## Section') {
      const { from, to } = v.state.selection;
      const typing = () => v.state.tr.insertText(ch, from, to);
      if (!v.someProp('handleTextInput', f => f(v, from, to, ch, typing))) v.dispatch(typing());
    }
    flushFlowView(v);
    expect(mounted.container.querySelector('h2#section')?.getAttribute('data-mx-ast')).toBe('0.0');
  });

  it.each([1, 2, 3, 4, 5, 6])('turns %i hash marks and a space at the start of a paragraph into that heading level', (level) => {
    const e = editor('<p id="a" className="mt-6 text-lg">Title</p>');
    e.caret('start');
    e.type(`${'#'.repeat(level)} `);
    expect(e.store.current()).toBe(`<h${level} id="a">Title</h${level}>`);
    expect(e.view.container.querySelector(`h${level}#a`)!.textContent).toBe('Title');
    e.type('New ');
    expect(e.store.current()).toBe(`<h${level} id="a">New Title</h${level}>`);
  });

  it.each([['* ', 'ul'], ['- ', 'ul'], ['1. ', 'ol']])('turns "%s" at the start of a paragraph into a %s item, keeping the paragraph\'s identity', (prefix, list) => {
    const e = editor('<p id="a" className="mt-6">item</p>');
    e.caret('start');
    e.type(prefix);
    expect(e.store.current()).toMatch(new RegExp(`^<${list} id="${ID}"><li id="${ID}"><p id="a">item</p></li></${list}>$`));
    expect(e.view.container.querySelector(`${list} > li > p#a`)!.textContent).toBe('item');
  });

  it('restores the literal prefix with one undo, then redoes the conversion', async () => {
    const e = editor('<p id="a" className="lead"></p>');
    e.type('## ');
    expect(e.store.current()).toBe('<h2 id="a"></h2>');
    expect((await e.store.undo()).ok).toBe(true);
    expect(e.store.current()).toBe('<p id="a" className="lead">## </p>');
    expect((await e.store.redo()).ok).toBe(true);
    expect(e.store.current()).toBe('<h2 id="a"></h2>');
    const e2 = editor('<p id="b"></p>');
    e2.type('- ');
    await e2.store.undo();
    expect(e2.store.current()).toBe('<p id="b">- </p>');
  });

  it('continues a list on Enter and leaves it on Enter in an empty item', () => {
    const e = editor('<p id="a"></p>');
    e.type('- one');
    e.enter();
    e.type('two');
    e.enter();
    expect(e.view.container.querySelectorAll('ul > li')).toHaveLength(3);
    e.enter();
    e.type('after');
    const source = e.store.current();
    expect(source).toMatch(new RegExp(`^<ul id="${ID}"><li id="${ID}"><p id="a">one</p></li><li id="${ID}"><p id="${ID}">two</p></li></ul><p id="${ID}">after</p>$`));
    expect(new Set(source.match(/id="[^"]+"/g)).size).toBe(source.match(/id="[^"]+"/g)!.length);
    const items = e.view.container.querySelectorAll('ul > li');
    expect(items).toHaveLength(2);
    expect(e.view.container.querySelector('ul + p')!.textContent).toBe('after');
  });

  it('numbers continued items in a numbered list', () => {
    const e = editor('<p id="a"></p>');
    e.type('1. first');
    e.enter();
    e.type('second');
    expect(e.store.current()).toMatch(new RegExp(`^<ol id="${ID}"><li id="${ID}"><p id="a">first</p></li><li id="${ID}"><p id="${ID}">second</p></li></ol>$`));
  });

  it('keeps the converted source through save and reload', () => {
    const e = editor('<p id="a">intro</p><p id="b"></p><p id="c"></p>');
    e.v().dispatch(e.v().state.tr.setSelection(TextSelection.create(e.v().state.doc, 'intro'.length + 3)));
    e.type('### Results');
    e.v().dispatch(e.v().state.tr.setSelection(TextSelection.atEnd(e.v().state.doc)));
    e.type('* point');
    const saved = e.store.current();
    const parsed = nodes(saved);
    expect(serializeJsx(sourceNodes(editorDocument(parsed)))).toBe(saved);
    const reloaded = render(() => <FlowEditor nodes={parsed} path="0" onChange={() => {}} />);
    expect(reloaded.container.querySelector('h3#b')!.textContent).toBe('Results');
    expect(reloaded.container.querySelector('ul > li > p#c')!.textContent).toBe('point');
    expect(reloaded.container.querySelector('p#a')!.textContent).toBe('intro');
  });

  it('types the marker literally inside code, mid-prose, inside lists, for other markers and while composing', () => {
    const code = editor('<pre id="c"></pre>');
    code.type('# x');
    expect(code.store.current()).toBe('<pre id="c"># x</pre>');
    const prose = editor('<p id="a">hello</p>');
    prose.caret('end');
    prose.type(' # - 1. x');
    expect(prose.store.current()).toBe('<p id="a">hello # - 1. x</p>');
    const listed = editor('<ul id="u"><li id="l"><p id="a"></p></li></ul>');
    listed.type('# x');
    expect(listed.store.current()).toBe('<ul id="u"><li id="l"><p id="a"># x</p></li></ul>');
    const other = editor('<p id="a"></p>');
    other.type('#tag 2. ####### +');
    expect(other.store.current()).toBe('<p id="a">#tag 2. ####### +</p>');
    const composing = editor('<p id="a"></p>');
    fireEvent.compositionStart(composing.view.getByRole('textbox'));
    composing.type('# ');
    expect(composing.store.current()).toBe('<p id="a"># </p>');
  });
});
