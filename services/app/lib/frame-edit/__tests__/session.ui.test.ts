/**
 * THE EDIT SESSION, THROUGH ITS INTERFACE (lib/frame-edit/session).
 *
 * A real `mountCompiledEditRegions` over a compiled-shaped DOM, a captured `channel.post`, and
 * nothing mocked inside the session: each case drives the document the way a user or the page does
 * and pins the message the parent receives. The browser gates (inplace-edit, editor-engine) cover layout;
 * these pin the protocol.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { $getSelection, $isRangeSelection } from 'lexical';
import { markdownEditorFor } from '@/lib/markdown/editor';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { mountCompiledEditRegions } from '@/lib/frame-edit/dom-mounter';
import { createFrameEditSession, type FrameEditSession } from '../session';

const SOURCE = '<div><p>Body text</p><img src="/a.png" alt="a" /><button>Label</button></div>';
const DOM = '<div data-mx-ast="0"><p data-mx-ast="0.0">Body text</p><img data-mx-ast="0.1" src="/a.png" alt="a"><button data-mx-ast="0.2">Label</button></div>';
const DECK_SOURCE = '<Deck><Slide title="One"><p>One</p></Slide><Slide title="Two"><p>Two</p></Slide></Deck>';
const DECK_DOM = '<nav class="mx-rail"><button class="mx-rail-row"><span class="mx-rail-label"><span class="mx-rail-title">One</span></span></button>'
  + '<button class="mx-rail-row"><span class="mx-rail-label"><span class="mx-rail-title">Two</span></span></button></nav>'
  + '<section data-mx-ast="0"><div data-mx-ast="0.0"><p data-mx-ast="0.0.0">One</p></div><div data-mx-ast="0.1"><p data-mx-ast="0.1.0">Two</p></div></section>';

// jsdom has no layout. ProseMirror measures the caret to scroll to it when a remounted editor takes focus.
Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() });

let session: FrameEditSession | null = null;
let root: HTMLElement | null = null;

afterEach(() => {
  session?.dispose();
  session = null;
  root?.remove();
  root = null;
  vi.restoreAllMocks();
});

/** A session over `dom`, mounted the way island-controller mounts it, with every post captured. */
async function open(source: string, dom: string) {
  root = document.createElement('div');
  root.innerHTML = dom;
  document.body.append(root);
  const posted: Array<Record<string, unknown>> = [];
  const channel = {
    nonce: 'test-nonce',
    post: (message: unknown) => posted.push(message as Record<string, unknown>),
    innerHtmlOf: (el: Element) => el.innerHTML,
  };
  session = createFrameEditSession({ win: window, root, channel, requestRender: () => {}, mountCompiled: mountCompiledEditRegions });
  session.setNodes(parseJsxOrThrow(source).nodes);
  await session.mountCompiledDom();
  const of = (type: string) => posted.filter((message) => message.type === type);
  return { root, posted, of, at: (path: string) => root!.querySelector<HTMLElement>(`[data-mx-ast="${path}"]`)! };
}

/** A drop as jsdom can carry it: no DragEvent or DataTransfer constructors, so the fields are defined on an Event. */
function drop(target: Element, file: File, clientY: number) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }], files: [file], types: ['Files'] },
  });
  Object.defineProperty(event, 'clientY', { value: clientY });
  target.dispatchEvent(event);
  return event;
}

describe('edit session', () => {
  it.each(['before', 'after'])('keeps explicit inserted Markdown focus requested %s a redraw over the former prose caret', async timing => {
    const { root } = await open('<p id="old1">Body text</p>', '<p id="old1" data-mx-ast="0">Body text</p>');
    const old = root.querySelector('.ProseMirror') as HTMLElement;
    old.focus();
    const focus = () => session!.onParentMessage({ type: 'mx:select', path: '1', nodeId: 'New1', reveal: true, focusText: true });
    if (timing === 'before') focus();
    session!.unmountCompiledDom();
    session!.setNodes(parseJsxOrThrow('<p id="old1">Body text</p><Markdown id="New1">{""}</Markdown>').nodes);
    root.innerHTML = '<p id="old1" data-mx-ast="0">Body text</p><div id="New1" data-mx-ast="1" data-mx-markdown></div>';
    await session!.mountCompiledDom();
    if (timing === 'after') focus();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const markdown = markdownEditorFor(root.querySelector('[data-mx-lexical]')!)!;
    expect(markdown.editor.getEditorState().read(() => $isRangeSelection($getSelection()))).toBe(true);
    expect(document.activeElement).not.toBe(root.querySelector('.ProseMirror'));
  });

  it('updates a doc outline from live source, including its title, without replacing the editor', async () => {
    const { root } = await open('<article id="doc"><h1 id="title"></h1><p id="body"></p></article>',
      '<div class="mx-reading"><nav class="mx-outline" hidden></nav><div class="mx-doc mx-doc--document"><article id="doc" data-mx-ast="0"><h1 id="title" data-mx-ast="0.0"></h1><p id="body" data-mx-ast="0.1"></p></article></div></div>');
    const editor = root.querySelector('.ProseMirror');
    session!.setNodes(parseJsxOrThrow('<article id="doc"><h1 id="title">My notes</h1><h2 id="body">Next steps</h2></article>').nodes);
    expect([...root.querySelectorAll('.mx-outline-row')].map(row => row.textContent)).toEqual(['My notes', 'Next steps']);
    expect(root.querySelector('.mx-outline')?.hasAttribute('hidden')).toBe(false);
    expect(root.querySelector('.ProseMirror')).toBe(editor);
    session!.setNodes(parseJsxOrThrow('<article id="doc"><h1 id="title">Renamed</h1><p id="body">Body</p></article>').nodes);
    expect([...root.querySelectorAll('.mx-outline-row')].map(row => row.textContent)).toEqual(['Renamed']);
    session!.setNodes(parseJsxOrThrow('<article id="doc"><h1 id="title"></h1><p id="body"></p></article>').nodes);
    expect(root.querySelectorAll('.mx-outline-row')).toHaveLength(0);
    expect(root.querySelector('.mx-outline')?.hasAttribute('hidden')).toBe(true);
  });
  it('posts the ready message, every message with the session nonce', async () => {
    const { posted } = await open(SOURCE, DOM);
    expect(posted[0]).toMatchObject({ type: 'mx:edit-ready', nonce: 'test-nonce' });
    expect(posted.every((message) => message.nonce === 'test-nonce')).toBe(true);
  });

  it('a click on a block posts mx:selection with its path and kind, block-selected', async () => {
    const { of, at } = await open(SOURCE, DOM);
    at('0.1').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(of('mx:selection').at(-1)?.selection).toMatchObject({ path: '0.1', kind: 'element', mode: 'block' });
  });

  it('a format on a non-prose host lands on the element and republishes the selection', async () => {
    const { of, at } = await open(SOURCE, DOM);
    const host = at('0.2');
    expect(host.closest('.ProseMirror')).toBeNull();
    host.focus();
    const before = of('mx:selection').length;
    session!.onParentMessage({ type: 'mx:apply-format', path: '0.2', className: 'text-lg' });
    expect(host.getAttribute('class')).toBe('text-lg');
    expect(of('mx:selection').length).toBe(before + 1);
    expect(of('mx:selection').at(-1)?.selection).toMatchObject({ path: '0.2' });
  });

  it('a link on a non-prose host posts mx:text-edit with the wrapped selection', async () => {
    const { of, at } = await open(SOURCE, DOM);
    const host = at('0.2');
    host.focus();
    const range = document.createRange();
    range.selectNodeContents(host.firstChild!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    session!.onParentMessage({ type: 'mx:apply-link', path: '0.2', href: 'https://example.com' });
    expect(of('mx:text-edit').at(-1)).toMatchObject({
      path: '0.2',
      innerHtml: '<a href="https://example.com" target="_blank" rel="noopener noreferrer">Label</a>',
    });
    // An active-content scheme is refused at the sink: nothing more is posted.
    const count = of('mx:text-edit').length;
    session!.onParentMessage({ type: 'mx:apply-link', path: '0.2', href: 'javascript:alert(1)' });
    expect(of('mx:text-edit').length).toBe(count);
  });

  it('an image file dropped on a block posts mx:image-drop with the side the pointer is on', async () => {
    const { of, at } = await open(SOURCE, DOM);
    const host = at('0.2');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { x: 0, y: 100, left: 0, top: 100, right: 200, bottom: 140, width: 200, height: 40, toJSON: () => ({}) } as DOMRect;
    });
    const file = new File(['x'], 'pic.png', { type: 'image/png' });
    expect(drop(host, file, 105).defaultPrevented).toBe(true);
    expect(of('mx:image-drop').at(-1)).toMatchObject({ file, at: { path: '0.2', side: 'before' } });
    drop(host, file, 135);
    expect(of('mx:image-drop').at(-1)).toMatchObject({ file, at: { path: '0.2', side: 'after' } });
    // Onto an image: that image is the target, replaced in place.
    drop(at('0.1'), file, 105);
    expect(of('mx:image-drop').at(-1)).toMatchObject({ file, target: '0.1' });
  });

  it('a drop that carries no image is left to the browser', async () => {
    const { of, at } = await open(SOURCE, DOM);
    const event = drop(at('0.2'), new File(['x'], 'notes.txt', { type: 'text/plain' }), 105);
    expect(event.defaultPrevented).toBe(false);
    expect(of('mx:image-drop')).toHaveLength(0);
  });

  it('a commit hands over half-typed text, then posts mx:committed', async () => {
    const { posted, at } = await open(SOURCE, DOM);
    const host = at('0.2');
    host.focus();
    host.innerHTML = 'Label edited';
    host.dispatchEvent(new Event('input', { bubbles: true }));
    const from = posted.length;
    session!.onParentMessage({ type: 'mx:commit' });
    const after = posted.slice(from).filter((m) => m.type === 'mx:text-edit' || m.type === 'mx:committed');
    expect(after).toEqual([
      expect.objectContaining({ type: 'mx:text-edit', path: '0.2', innerHtml: 'Label edited' }),
      expect.objectContaining({ type: 'mx:committed' }),
    ]);
  });

  it('Ctrl-Z inside a slide-title input stays with the input: no mx:history, no preventDefault', async () => {
    const { of, root: deck } = await open(DECK_SOURCE, DECK_DOM);
    deck.querySelector<HTMLElement>('[aria-label="Edit slide 2 title"]')!.click();
    const input = deck.querySelector<HTMLInputElement>('[aria-label="Slide 2 title"]')!;
    expect(input).not.toBeNull();
    for (const init of [{ key: 'z', ctrlKey: true }, { key: 'z', metaKey: true, shiftKey: true }, { key: 'y', ctrlKey: true }]) {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(of('mx:history')).toHaveLength(0);
  });

  it('dispose removes the injected edit stylesheet and stops listening', async () => {
    const { at, posted } = await open(SOURCE, DOM);
    expect(document.querySelector('style[data-mx-edit-css]')).not.toBeNull();
    session!.dispose();
    session = null;
    expect(document.querySelector('style[data-mx-edit-css]')).toBeNull();
    const from = posted.length;
    at('0.1').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(posted.slice(from)).toEqual([]);
  });

  it('puts the Undo/Redo caret on the redrawn block, not where the stale draft still held the same block', async () => {
    const frame = () => new Promise((r) => setTimeout(r, 40));
    const { root } = await open('<div><h3 id="x"></h3></div>', '<div data-mx-ast="0"><h3 id="x" data-mx-ast="0.0"></h3></div>');
    const editor = root.querySelector<HTMLElement>('.ProseMirror')!;
    editor.focus();
    await frame();
    // The undo of a `### ` shortcut: the history target is the end of the literal prefix, in block x.
    session!.onParentMessage({ type: 'mx:commit', restore: { anchor: { id: 'x', offset: 4 }, head: { id: 'x', offset: 4 } } });
    await frame();
    // The undo's draft lands: block x is a paragraph again.
    session!.unmountCompiledDom();
    root.innerHTML = '<div data-mx-ast="0"><p id="x" data-mx-ast="0.0">### </p></div>';
    session!.setNodes(parseJsxOrThrow('<div><p id="x">### </p></div>').nodes);
    await session!.mountCompiledDom();
    await frame();
    const native = window.getSelection()!;
    expect(native.anchorNode?.textContent).toBe('### ');
    expect(native.anchorOffset).toBe(4);
  });

  it('keeps a caret the person moved after Undo/Redo when the next draft is drawn', async () => {
    const frame = () => new Promise((r) => setTimeout(r, 40));
    const { root } = await open('<div><p id="x">alpha bravo</p></div>', '<div data-mx-ast="0"><p id="x" data-mx-ast="0.0">alpha bravo</p></div>');
    const editor = root.querySelector<HTMLElement>('.ProseMirror')!;
    editor.focus();
    await frame();
    session!.onParentMessage({ type: 'mx:commit', restore: { anchor: { id: 'x', offset: 11 }, head: { id: 'x', offset: 11 } } });
    await frame();
    // The person selects "alpha" before the undo's draft is drawn 
    const text = root.querySelector('p#x')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await frame();
    session!.unmountCompiledDom();
    root.innerHTML = '<div data-mx-ast="0"><p id="x" data-mx-ast="0.0">alpha bravo</p></div>';
    await session!.mountCompiledDom();
    await frame();
    const native = getSelection()!;
    expect([native.anchorOffset, native.focusOffset]).toEqual([0, 5]);
  });
});

describe('kit text components in the edit session', () => {
  const KIT = '<Card id="card"><CardHeader id="hd"><CardTitle id="ct" className="text-lg">Revenue</CardTitle></CardHeader>'
    + '<CardContent id="cc"><Table id="t"><TableBody id="tb"><TableRow id="r"><TableCell id="eVAF">Wed</TableCell><TableCell id="tot">{$q.rows[0].total}</TableCell></TableRow></TableBody></Table></CardContent></Card>'
    + '<Breadcrumb id="bc"><BreadcrumbList id="bl"><BreadcrumbItem id="bi"><BreadcrumbLink id="bk" href="/reports">Reports</BreadcrumbLink></BreadcrumbItem></BreadcrumbList></Breadcrumb>';
  /** The compiled reader's static kit HTML for KIT: recipe classes and data-slot on each element, the AST stamp on the node's own. */
  const KIT_DOM = '<div data-slot="card" class="rounded-xl border" id="card" data-mx-ast="0"><div data-slot="card-header" id="hd" data-mx-ast="0.0"><div data-slot="card-title" class="text-lg" id="ct" data-mx-ast="0.0.0">Revenue</div></div>'
    + '<div data-slot="card-content" id="cc" data-mx-ast="0.1"><div data-slot="table-container"><table data-slot="table" id="t" data-mx-ast="0.1.0"><tbody data-slot="table-body" id="tb" data-mx-ast="0.1.0.0"><tr data-slot="table-row" id="r" data-mx-ast="0.1.0.0.0">'
    + '<td data-slot="table-cell" class="p-2" id="eVAF" data-mx-ast="0.1.0.0.0.0">Wed</td><td data-slot="table-cell" class="p-2" id="tot" data-mx-ast="0.1.0.0.0.1">1,204</td></tr></tbody></table></div></div></div>'
    + '<nav aria-label="breadcrumb" data-slot="breadcrumb" id="bc" data-mx-ast="1"><ol data-slot="breadcrumb-list" id="bl" data-mx-ast="1.0"><li data-slot="breadcrumb-item" id="bi" data-mx-ast="1.0.0"><a data-slot="breadcrumb-link" href="/reports" id="bk" data-mx-ast="1.0.0.0">Reports</a></li></ol></nav>';
  const CELL = '0.1.0.0.0.0';
  const focus = (el: HTMLElement) => { el.focus(); el.dispatchEvent(new FocusEvent('focus')); };
  const caretIn = (el: HTMLElement, offset = 1) => {
    const range = document.createRange();
    range.setStart(el.firstChild!, offset);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  };
  const key = (el: HTMLElement, init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(event);
    return event;
  };

  it('a kit cell, a card title and a breadcrumb link take a caret; a cell from data does not', async () => {
    const { at } = await open(KIT.replace('>Revenue<', '><b>Net</b> revenue<'), KIT_DOM.replace('>Revenue<', '><b data-mx-ast="0.0.0.0">Net</b> revenue<'));
    // Its marks are its text, typed in through it: not hosts of their own.
    expect(at('0.0.0.0').contentEditable).not.toBe('true');
    expect(at(CELL).contentEditable).toBe('true');
    expect(at('0.0.0').contentEditable).toBe('true');
    expect(at('1.0.0.0').contentEditable).toBe('true');
    expect(at('0.1.0.0.0.1').contentEditable).not.toBe('true');
    expect(at('0').contentEditable).not.toBe('true');
  });

  it('focusing a kit cell reports a TEXT selection on it; typing then leaving posts its new text', async () => {
    const { of, at } = await open(KIT, KIT_DOM);
    const cell = at(CELL);
    focus(cell);
    expect(of('mx:selection').at(-1)?.selection).toMatchObject({ kind: 'text', path: CELL, tag: 'TableCell', nodeId: 'eVAF', mode: 'typing' });
    cell.textContent = 'Thu';
    cell.dispatchEvent(new Event('input', { bubbles: true }));
    cell.blur();
    cell.dispatchEvent(new FocusEvent('blur'));
    expect(of('mx:text-edit').at(-1)).toMatchObject({ path: CELL, innerHtml: 'Thu' });
  });

  it('a click on a cell whose text comes from data selects that cell and says why it takes no caret', async () => {
    const { of, at } = await open(KIT, KIT_DOM);
    at('0.1.0.0.0.1').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(of('mx:selection').at(-1)?.selection).toMatchObject({ kind: 'embed', path: '0.1.0.0.0.1', tag: 'TableCell', mode: 'block', textLock: 'Text comes from data' });
  });

  it('select-all selects the text of the cell being edited, never the page', async () => {
    const { at } = await open(KIT, KIT_DOM);
    const cell = at(CELL);
    focus(cell);
    caretIn(cell);
    const event = key(cell, { key: 'a', ctrlKey: !/Mac/.test(navigator.platform), metaKey: /Mac/.test(navigator.platform) });
    expect(event.defaultPrevented).toBe(true);
    const range = window.getSelection()!.getRangeAt(0);
    expect(window.getSelection()!.toString()).toBe('Wed');
    expect(cell.contains(range.startContainer) && cell.contains(range.endContainer)).toBe(true);
  });

  it('Enter never splits a kit text into blocks it cannot hold', async () => {
    const { at } = await open(KIT, KIT_DOM);
    const cell = at(CELL);
    focus(cell);
    caretIn(cell);
    expect(key(cell, { key: 'Enter' }).defaultPrevented).toBe(true);
  });

  it('a paste into a kit text is its plain text on one line, typed where the caret is', async () => {
    const { of, at } = await open(KIT, KIT_DOM);
    const cell = at(CELL);
    focus(cell);
    caretIn(cell, 3);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: (type: string) => type === 'text/plain' ? 'nes\n  day' : type === 'text/html' ? '<p>nes</p><p>day</p>' : '' } });
    cell.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(cell.innerHTML).toBe('Wednes day');
    expect(of('mx:edit-error')).toHaveLength(0);
    session!.onParentMessage({ type: 'mx:commit' });
    expect(of('mx:text-edit').at(-1)).toMatchObject({ path: CELL, innerHtml: 'Wednes day' });
  });

  it('the toolbar\'s bold, italic and underline wrap the selected words in the kit text, and unwrap them again', async () => {
    const { of, at } = await open(KIT, KIT_DOM);
    const cell = at(CELL);
    focus(cell);
    const range = document.createRange();
    range.selectNodeContents(cell);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    session!.onParentMessage({ type: 'mx:inline', tag: 'strong' });
    expect(cell.innerHTML).toBe('<strong>Wed</strong>');
    expect(of('mx:text-edit').at(-1)).toMatchObject({ path: CELL, innerHtml: '<strong>Wed</strong>' });
    const inner = document.createRange();
    inner.selectNodeContents(cell.querySelector('strong')!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(inner);
    session!.onParentMessage({ type: 'mx:inline', tag: 'strong' });
    expect(cell.innerHTML).toBe('Wed');
    expect(of('mx:text-edit').at(-1)).toMatchObject({ path: CELL, innerHtml: 'Wed' });
  });

  it('bold from the page\'s toolbar still lands when the click there took the focus from the kit text', async () => {
    const { of, at } = await open(KIT, KIT_DOM);
    const title = at('0.0.0');
    focus(title);
    const range = document.createRange();
    range.selectNodeContents(title);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    title.blur();
    title.dispatchEvent(new FocusEvent('blur'));
    session!.onParentMessage({ type: 'mx:inline', tag: 'em' });
    expect(of('mx:text-edit').at(-1)).toMatchObject({ path: '0.0.0', innerHtml: '<em>Revenue</em>' });
  });

  it('a click in a breadcrumb link being edited is a caret, never a navigation', async () => {
    const { at } = await open(KIT, KIT_DOM);
    const link = at('1.0.0.0');
    focus(link);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it('a breadcrumb link takes no link inside it', async () => {
    const { of, at } = await open(KIT, KIT_DOM);
    const link = at('1.0.0.0');
    focus(link);
    const range = document.createRange();
    range.selectNodeContents(link);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    session!.onParentMessage({ type: 'mx:apply-link', path: '1.0.0.0', href: 'https://example.com' });
    expect(link.querySelector('a')).toBeNull();
    expect(of('mx:text-edit')).toHaveLength(0);
  });
});

describe('plain HTML text in the edit session', () => {
  // Each paragraph holds an expression, so none is a prose block: each is a text host of its own, or locked text.
  // The bound paragraph's text comes from data through a <Cell>: a plain `{$x}` read is a template chip instead (below).
  const PLAIN = '<div id="m"><p id="a">Hello {"there"} <strong id="s">bold</strong> words</p><p id="b">Total: <Cell id="c" data="$q" col="n" /> <em id="e">items</em></p></div>';
  const PLAIN_DOM = '<div id="m" data-mx-ast="0"><p id="a" data-mx-ast="0.0">Hello there <strong id="s" data-mx-ast="0.0.3">bold</strong> words</p>'
    + '<p id="b" data-mx-ast="0.1">Total: 42 <em id="e" data-mx-ast="0.1.3">items</em></p></div>';

  // jsdom does not reflect `contentEditable` to the attribute: the property is what the mounter set.
  it('a paragraph of text takes a caret and its marks are its text; a paragraph bound to data takes none', async () => {
    const { at } = await open(PLAIN, PLAIN_DOM);
    expect(at('0.0').contentEditable).toBe('true');
    expect(at('0.0.3').contentEditable).not.toBe('true');
    expect(at('0.1').contentEditable).not.toBe('true');
    expect(at('0.1.3').contentEditable).not.toBe('true');
  });

  it('the pointer over a mark is over the text it is part of, editable or locked', async () => {
    const { at } = await open(PLAIN, PLAIN_DOM);
    for (const [mark, text] of [['0.0.3', '0.0'], ['0.1.3', '0.1']]) {
      at(mark).dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      expect(at(text).hasAttribute('data-mx-edit-hover')).toBe(true);
      expect(at(mark).hasAttribute('data-mx-edit-hover')).toBe(false);
    }
  });

  it('a paragraph reading a value is prose with the value as one uneditable chip naming its source', async () => {
    const { at } = await open('<div id="m"><p id="a">Hello {"there"}</p><p id="b">Total: {$tiles.n} <em id="e">items</em></p></div>',
      '<div id="m" data-mx-ast="0"><p id="a" data-mx-ast="0.0">Hello there</p><p id="b" data-mx-ast="0.1">Total: 42 <em id="e" data-mx-ast="0.1.3">items</em></p></div>');
    const editor = root!.querySelector<HTMLElement>('.ProseMirror')!;
    expect(editor).not.toBeNull();
    const chip = editor.querySelector<HTMLElement>('[data-mx-template="tiles.n"]')!;
    expect(chip.getAttribute('contenteditable')).toBe('false');
    expect(chip.getAttribute('data-mx-template-query')).toBe('tiles');
    expect(chip.textContent).toBe('tiles.n');
    expect(editor.textContent).not.toContain('42');
    expect(at('0.0').contentEditable).toBe('true');
  });

  it('a click on bound text, or on a mark in it, selects that text and says why it takes no caret', async () => {
    const { of, at } = await open(PLAIN, PLAIN_DOM);
    for (const path of ['0.1', '0.1.3']) {
      at(path).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(of('mx:selection').at(-1)?.selection).toMatchObject({ kind: 'element', path: '0.1', tag: 'p', mode: 'block', textLock: 'Text comes from data' });
    }
  });
});

describe('a Markdown editor in the edit session', () => {
  it('a click in its text keeps the caret there: its component lock never turns it into a block selection', async () => {
    const { of, root } = await open('<Markdown id="md">{"Hello there"}</Markdown>', '<div id="md" data-mx-ast="0" data-mx-markdown></div>');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const text = root.querySelector('[data-mx-lexical] p, [data-mx-lexical] span') ?? root.querySelector('[data-mx-lexical]')!;
    text.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(of('mx:selection').map((m) => (m.selection as { mode?: string } | null)?.mode)).not.toContain('block');
  });
});
