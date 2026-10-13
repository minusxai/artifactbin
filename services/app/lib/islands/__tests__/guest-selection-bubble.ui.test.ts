/**
 * A GUEST'S FIRST SELECTION GETS ITS BUBBLE (lib/islands/island-controller `setNodes`, the frame bridge's `nodes`).
 *
 * A guest's framed document is attached without its node tree: the page asks for it on the reader's first press,
 * and the selection that press starts usually finishes before the tree arrives. The real controller and the real
 * selection actions: nothing describes that selection while the tree is on its way (no bubble), and the tree's
 * arrival into the SAME controller describes it again and shows the Comment bubble — for a mouse, a keyboard and a
 * touch selection — without the reader selecting again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getByRole, queryByRole, waitFor } from '@testing-library/dom';
import { createIslandController } from '@/lib/islands/island-controller';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

const tree = parseJsxOrThrow('<p>select these words</p>').nodes;
const RECT = { x: 100, y: 80, left: 100, top: 80, right: 240, bottom: 100, width: 140, height: 20, toJSON: () => ({}) };

let coarse = false;
beforeEach(() => {
  coarse = false;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => RECT as DOMRect);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query === '(pointer: coarse)', media: query, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

/** A guest's document: attached with no tree, granted the Comment action (Comment → sign-in) as the page grants it. */
async function guestDocument() {
  const root = document.createElement('div');
  root.setAttribute('data-mx-inline-story', '');
  root.innerHTML = '<p data-mx-ast="0">select these words</p>';
  const portal = document.createElement('div');
  document.body.append(root, portal);
  const controller = createIslandController({
    win: window, root, islands: null, nodes: [], id: 'doc', editId: () => 'e1', initialSource: () => null, portal: { current: portal },
  });
  controller.selectionReady();
  controller.send({ type: 'mx:selection-actions', edit: false, annotate: true });
  // The selection actions are their own lazy chunk: loaded once granted.
  await waitFor(() => expect(portal.querySelector('style')).not.toBeNull());
  return { controller, portal, dispose: () => controller.dispose() };
}

/** The words selected, with the range's box a browser would give it. */
function selectWords() {
  const range = document.createRange();
  range.selectNodeContents(document.querySelector('p')!.firstChild!);
  Object.defineProperty(range, 'getBoundingClientRect', { value: () => RECT });
  Object.defineProperty(range, 'getClientRects', { value: () => [RECT] });
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

const settle = (ms = 260) => new Promise((resolve) => setTimeout(resolve, ms));
const bubble = (portal: HTMLElement) => queryByRole(portal, 'toolbar', { name: 'Text selection actions' });

describe('a guest\'s first selection', () => {
  it.each([
    ['a mouse', () => document.querySelector('p')!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))],
    ['the keyboard', () => document.querySelector('p')!.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }))],
    ['a touch (a long-press: no pointer event, only the selection changing)', () => { coarse = true; document.dispatchEvent(new Event('selectionchange')); }],
  ])('made with %s before the tree arrives gets its Comment bubble when the tree arrives', async (_how, finish) => {
    const { controller, portal, dispose } = await guestDocument();
    try {
      selectWords();
      finish();
      await settle();
      // Nothing describes the selection yet: no bubble.
      expect(bubble(portal)).toBeNull();

      controller.setNodes(tree);
      const toolbar = await waitFor(() => getByRole(portal, 'toolbar', { name: 'Text selection actions' }));
      expect(toolbar.hidden).toBe(false);
      expect(getByRole(toolbar, 'button', { name: 'Comment on selected text' })).toBeTruthy();
    } finally { dispose(); }
  });

  it('a tree arriving with nothing selected draws no bubble, and the next selection gets one', async () => {
    const { controller, portal, dispose } = await guestDocument();
    try {
      controller.setNodes(tree);
      await settle(20);
      expect(bubble(portal)).toBeNull();
      selectWords();
      document.querySelector('p')!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
      await waitFor(() => expect(getByRole(portal, 'button', { name: 'Comment on selected text' })).toBeTruthy());
    } finally { dispose(); }
  });
});
