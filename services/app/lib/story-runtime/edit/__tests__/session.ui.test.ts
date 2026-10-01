/**
 * THE EDIT SESSION, THROUGH ITS INTERFACE (lib/story-runtime/edit/session).
 *
 * A real `mountCompiledEditRegions` over a compiled-shaped DOM, a captured `channel.post`, and
 * nothing mocked inside the session: each case drives the document the way a user or the page does
 * and pins the message the parent receives. The browser gates (inplace-edit, editor-v2) cover layout;
 * these pin the protocol.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { mountCompiledEditRegions } from '@/solid/editor/dom-mounter';
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
});
