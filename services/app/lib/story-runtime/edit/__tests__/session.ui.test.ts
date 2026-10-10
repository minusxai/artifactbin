/**
 * THE EDIT SESSION, THROUGH ITS INTERFACE (lib/story-runtime/edit/session).
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
import { mountCompiledEditRegions } from '@/lib/story-runtime/edit/dom-mounter';
import { morphDraftDom } from '@/lib/islands/morph/engine';
import { createFrameEditSession, type FrameEditSession } from '../session';
import {
  STORY_APPLY_FORMAT_MESSAGE,
  STORY_APPLY_LINK_MESSAGE,
  STORY_COMMIT_MESSAGE,
  STORY_COMMITTED_MESSAGE,
  STORY_HISTORY_MESSAGE,
  STORY_IMAGE_DROP_MESSAGE,
  STORY_SELECTION_MESSAGE,
  STORY_TEXT_EDIT_MESSAGE,
} from '../../contract';

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
    expect(of(STORY_SELECTION_MESSAGE).at(-1)?.selection).toMatchObject({ path: '0.1', kind: 'element', mode: 'block' });
  });

  it('a format on a non-prose host lands on the element and republishes the selection', async () => {
    const { of, at } = await open(SOURCE, DOM);
    const host = at('0.2');
    expect(host.closest('.ProseMirror')).toBeNull();
    host.focus();
    const before = of(STORY_SELECTION_MESSAGE).length;
    session!.onParentMessage({ type: STORY_APPLY_FORMAT_MESSAGE, path: '0.2', className: 'text-lg' });
    expect(host.getAttribute('class')).toBe('text-lg');
    expect(of(STORY_SELECTION_MESSAGE).length).toBe(before + 1);
    expect(of(STORY_SELECTION_MESSAGE).at(-1)?.selection).toMatchObject({ path: '0.2' });
  });

  it('a link on a non-prose host posts mx:text-edit with the wrapped selection', async () => {
    const { of, at } = await open(SOURCE, DOM);
    const host = at('0.2');
    host.focus();
    const range = document.createRange();
    range.selectNodeContents(host.firstChild!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    session!.onParentMessage({ type: STORY_APPLY_LINK_MESSAGE, path: '0.2', href: 'https://example.com' });
    expect(of(STORY_TEXT_EDIT_MESSAGE).at(-1)).toMatchObject({
      path: '0.2',
      innerHtml: '<a href="https://example.com" target="_blank" rel="noopener noreferrer">Label</a>',
    });
    // An active-content scheme is refused at the sink: nothing more is posted.
    const count = of(STORY_TEXT_EDIT_MESSAGE).length;
    session!.onParentMessage({ type: STORY_APPLY_LINK_MESSAGE, path: '0.2', href: 'javascript:alert(1)' });
    expect(of(STORY_TEXT_EDIT_MESSAGE).length).toBe(count);
  });

  it('an image file dropped on a block posts mx:image-drop with the side the pointer is on', async () => {
    const { of, at } = await open(SOURCE, DOM);
    const host = at('0.2');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { x: 0, y: 100, left: 0, top: 100, right: 200, bottom: 140, width: 200, height: 40, toJSON: () => ({}) } as DOMRect;
    });
    const file = new File(['x'], 'pic.png', { type: 'image/png' });
    expect(drop(host, file, 105).defaultPrevented).toBe(true);
    expect(of(STORY_IMAGE_DROP_MESSAGE).at(-1)).toMatchObject({ file, at: { path: '0.2', side: 'before' } });
    drop(host, file, 135);
    expect(of(STORY_IMAGE_DROP_MESSAGE).at(-1)).toMatchObject({ file, at: { path: '0.2', side: 'after' } });
    // Onto an image: that image is the target, replaced in place.
    drop(at('0.1'), file, 105);
    expect(of(STORY_IMAGE_DROP_MESSAGE).at(-1)).toMatchObject({ file, target: '0.1' });
  });

  it('a drop that carries no image is left to the browser', async () => {
    const { of, at } = await open(SOURCE, DOM);
    const event = drop(at('0.2'), new File(['x'], 'notes.txt', { type: 'text/plain' }), 105);
    expect(event.defaultPrevented).toBe(false);
    expect(of(STORY_IMAGE_DROP_MESSAGE)).toHaveLength(0);
  });

  it('a commit hands over half-typed text, then posts mx:committed', async () => {
    const { posted, at } = await open(SOURCE, DOM);
    const host = at('0.2');
    host.focus();
    host.innerHTML = 'Label edited';
    host.dispatchEvent(new Event('input', { bubbles: true }));
    const from = posted.length;
    session!.onParentMessage({ type: STORY_COMMIT_MESSAGE });
    const after = posted.slice(from).filter((m) => m.type === STORY_TEXT_EDIT_MESSAGE || m.type === STORY_COMMITTED_MESSAGE);
    expect(after).toEqual([
      expect.objectContaining({ type: STORY_TEXT_EDIT_MESSAGE, path: '0.2', innerHtml: 'Label edited' }),
      expect.objectContaining({ type: STORY_COMMITTED_MESSAGE }),
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
    expect(of(STORY_HISTORY_MESSAGE)).toHaveLength(0);
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
    session!.onParentMessage({ type: STORY_COMMIT_MESSAGE, restore: { anchor: { id: 'x', offset: 4 }, head: { id: 'x', offset: 4 } } });
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

  it('keeps the editor holding the caret across a redraw of the prose it shows: same editor, focus and caret', async () => {
    const frame = () => new Promise((r) => setTimeout(r, 40));
    const nodes = parseJsxOrThrow('<div><p id="x">alpha bravo</p></div>').nodes;
    const { root } = await open('<div><p id="x">alpha bravo</p></div>', '<div data-mx-ast="0"><p id="x" data-mx-ast="0.0">alpha bravo</p></div>');
    const editor = root.querySelector<HTMLElement>('.ProseMirror')!;
    editor.focus();
    const text = root.querySelector('p#x')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 3);
    range.setEnd(text, 3);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await frame();
    // The draft compiles the same prose differently (what the editor's own structural edit redraws).
    const draft = document.createElement('div');
    draft.innerHTML = '<div data-mx-ast="0"><p id="x" class="lead" data-mx-ast="0.0">alpha bravo</p></div>';
    const kept = session!.holdUnchanged(nodes, draft);
    expect(kept.size).toBe(1);
    session!.unmountCompiledDom();
    morphDraftDom(root, draft, new Set(), new Set(), kept);
    session!.setNodes(nodes);
    await session!.mountCompiledDom();
    await frame();
    expect(root.querySelector('.ProseMirror')).toBe(editor);
    expect(editor.contains(document.activeElement) || document.activeElement === editor).toBe(true);
    expect([getSelection()!.anchorNode?.textContent, getSelection()!.anchorOffset]).toEqual(['alpha bravo', 3]);
  });

  it('keeps a caret the person moved after Undo/Redo when the next draft is drawn', async () => {
    const frame = () => new Promise((r) => setTimeout(r, 40));
    const { root } = await open('<div><p id="x">alpha bravo</p></div>', '<div data-mx-ast="0"><p id="x" data-mx-ast="0.0">alpha bravo</p></div>');
    const editor = root.querySelector<HTMLElement>('.ProseMirror')!;
    editor.focus();
    await frame();
    session!.onParentMessage({ type: STORY_COMMIT_MESSAGE, restore: { anchor: { id: 'x', offset: 11 }, head: { id: 'x', offset: 11 } } });
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
