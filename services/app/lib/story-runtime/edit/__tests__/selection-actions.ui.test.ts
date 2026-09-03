import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { createFrameSelectionActions, SELECTION_ACTION_COARSE_CLASS, SELECTION_ACTIONS_ATTR } from '../selection-actions';

const parsed = parseJsx('<p>select these words</p>');
if (!parsed.ok) throw new Error('fixture does not parse');

let actions: ReturnType<typeof createFrameSelectionActions>;
const onAction = vi.fn();

/** Where the selected words currently sit in the viewport — moved by a scroll. */
let rangeRect = { x: 100, y: 80, left: 100, top: 80, right: 240, bottom: 100, width: 140, height: 20 };

const selectText = async () => {
  const text = document.querySelector('p')!.firstChild!;
  const range = document.createRange();
  range.selectNodeContents(text);
  Object.defineProperty(range, 'getBoundingClientRect', {
    value: () => ({ ...rangeRect, toJSON: () => ({}) }),
  });
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.querySelector('p')!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  await Promise.resolve();
};

/** The Range a touch gesture leaves behind — set with no pointer event at all. */
const selectRange = () => {
  const text = document.querySelector('p')!.firstChild!;
  const range = document.createRange();
  range.selectNodeContents(text);
  Object.defineProperty(range, 'getBoundingClientRect', {
    value: () => ({ ...rangeRect, toJSON: () => ({}) }),
  });
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
};

const bubbleVisible = () => {
  const element = document.querySelector<HTMLElement>(`[${SELECTION_ACTIONS_ATTR}]`);
  return !!element && !element.hidden;
};

beforeEach(() => {
  onAction.mockClear();
  rangeRect = { x: 100, y: 80, left: 100, top: 80, right: 240, bottom: 100, width: 140, height: 20 };
  document.body.innerHTML = '<p data-mx-ast="0">select these words</p>';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute(SELECTION_ACTIONS_ATTR)) {
      return { x: 0, y: 0, left: 0, top: 0, right: 132, bottom: 30, width: 132, height: 30, toJSON: () => ({}) };
    }
    return { x: 100, y: 80, left: 100, top: 80, right: 240, bottom: 100, width: 140, height: 20, toJSON: () => ({}) };
  });
  actions = createFrameSelectionActions({ win: window, onAction });
  actions.setNodes(parsed.nodes);
});

afterEach(() => {
  actions.dispose();
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('view-mode text selection actions', () => {
  /*
   * A triple-click, and a drag that ends at the end of a line, leave the Range
   * ENDING at offset 0 of the following block — a node the selection does not
   * cover a single character of. Preferring the deeper endpoint then hands the
   * action to whatever happens to sit deeper in the next subtree, which on a
   * deck slide meant commenting on a column label three elements away from the
   * heading that was highlighted.
   */
  it('ignores an endpoint the selection does not actually cover', async () => {
    // Paths mirror the parsed source's child indices exactly, as the runtime stamps them.
    document.body.innerHTML = '<div data-mx-ast="0">'
      + '<h1 data-mx-ast="0.0">the heading that was selected</h1>'
      + '<div data-mx-ast="0.1"><div data-mx-ast="0.1.0"><p data-mx-ast="0.1.0.0">1.0 · Build</p></div></div>'
      + '</div>';
    const deep = parseJsx('<div><h1>the heading that was selected</h1><div><div><p>1.0 · Build</p></div></div></div>');
    if (!deep.ok) throw new Error('fixture does not parse');
    actions.setNodes(deep.nodes);
    actions.update({ type: 'mx:selection-actions', edit: false, annotate: true });

    const heading = document.querySelector('h1')!;
    const trailing = document.querySelector('p')!;
    const range = document.createRange();
    range.setStart(heading.firstChild!, 0);
    // …ends BEFORE the paragraph's first character: zero of it is selected.
    range.setEnd(trailing.firstChild!, 0);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => ({ ...rangeRect, toJSON: () => ({}) }),
    });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    heading.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await Promise.resolve();

    document.querySelector<HTMLButtonElement>('[aria-label="Annotate selected text"]')!.click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][1]).toMatchObject({ path: '0.0', tag: 'h1' });
  });

  it('shows only authorized actions and reports the containing source node', async () => {
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: false });
    await selectText();

    const toolbar = document.querySelector<HTMLElement>(`[${SELECTION_ACTIONS_ATTR}]`)!;
    expect(toolbar).not.toHaveAttribute('hidden');
    expect(toolbar.getAttribute('aria-label')).toBe('Text selection actions');
    expect(toolbar.querySelector('[aria-label="Edit selected text"] .lucide-pencil')).toBeTruthy();
    expect(toolbar.querySelector('[aria-label="Annotate selected text"]')).toBeNull();

    toolbar.querySelector<HTMLButtonElement>('[aria-label="Edit selected text"]')!.click();
    expect(onAction).toHaveBeenCalledWith('edit', expect.objectContaining({ path: '0', tag: 'p', kind: 'text' }));
    expect(toolbar).toHaveAttribute('hidden');
  });

  it('renders annotate alone for an owner without exposing edit', async () => {
    actions.update({ type: 'mx:selection-actions', edit: false, annotate: true });
    await selectText();
    const toolbar = document.querySelector<HTMLElement>(`[${SELECTION_ACTIONS_ATTR}]`)!;
    expect(toolbar.querySelector('[aria-label="Edit selected text"]')).toBeNull();
    expect(toolbar.querySelector('[aria-label="Annotate selected text"] .lucide-message-square')).toBeTruthy();
  });

  it('targets the deepest source element at the selection edges, not their outer ancestor', async () => {
    const nested = parseJsx('<div><p><strong>inner</strong> outer</p></div>');
    if (!nested.ok) throw new Error('nested fixture does not parse');
    document.body.innerHTML = '<div data-mx-ast="0"><p data-mx-ast="0.0"><strong data-mx-ast="0.0.0">inner</strong> outer</p></div>';
    actions.setNodes(nested.nodes);
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: false });

    const strongText = document.querySelector('strong')!.firstChild!;
    const paragraphText = document.querySelector('p')!.lastChild!;
    const range = document.createRange();
    range.setStart(strongText, 0);
    range.setEnd(paragraphText, paragraphText.textContent!.length);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => ({ x: 100, y: 80, left: 100, top: 80, right: 240, bottom: 100, width: 140, height: 20, toJSON: () => ({}) }),
    });
    const nativeSelection = window.getSelection()!;
    nativeSelection.removeAllRanges();
    nativeSelection.addRange(range);
    document.querySelector('p')!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await Promise.resolve();

    document.querySelector<HTMLButtonElement>('[aria-label="Edit selected text"]')!.click();
    expect(onAction).toHaveBeenCalledWith('edit', expect.objectContaining({ path: '0.0.0', tag: 'strong', kind: 'text' }));
  });

  /*
   * ADDED (F3). Edit and Annotate want DIFFERENT nodes from the same Range:
   * the editor should open on the deepest element the user touched, while a
   * comment belongs to the BLOCK that contains the whole selection — anchoring
   * a comment on the <strong> is how the rest of the sentence used to be lost.
   * The words themselves travel with it.
   */
  it('annotates the BLOCK containing the selection, and carries the quote and its parts', async () => {
    const nested = parseJsx('<div><p><strong>inner</strong> outer</p></div>');
    if (!nested.ok) throw new Error('nested fixture does not parse');
    document.body.innerHTML = '<div data-mx-ast="0"><p data-mx-ast="0.0"><strong data-mx-ast="0.0.0">inner</strong> outer</p></div>';
    actions.setNodes(nested.nodes);
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: true });

    const strongText = document.querySelector('strong')!.firstChild!;
    const paragraphText = document.querySelector('p')!.lastChild!;
    const range = document.createRange();
    range.setStart(strongText, 2);
    range.setEnd(paragraphText, paragraphText.textContent!.length);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => ({ x: 100, y: 80, left: 100, top: 80, right: 240, bottom: 100, width: 140, height: 20, toJSON: () => ({}) }),
    });
    const nativeSelection = window.getSelection()!;
    nativeSelection.removeAllRanges();
    nativeSelection.addRange(range);
    document.querySelector('p')!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await Promise.resolve();

    document.querySelector<HTMLButtonElement>('[aria-label="Annotate selected text"]')!.click();
    expect(onAction).toHaveBeenCalledTimes(1);
    const [action, selection] = onAction.mock.calls[0];
    expect(action).toBe('annotate');
    expect(selection).toMatchObject({ path: '0.0', tag: 'p' });
    expect(selection.quote).toBe('ner outer');
    expect(selection.range).toEqual({
      v: 1,
      parts: [
        { rel: '0', start: 2, end: 5, text: 'ner' },
        { rel: '', start: 5, end: 11, text: ' outer' },
      ],
    });

    // The same Range, the other action: the editor still opens on what was touched.
    onAction.mockClear();
    document.querySelector('p')!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await Promise.resolve();
    document.querySelector<HTMLButtonElement>('[aria-label="Edit selected text"]')!.click();
    expect(onAction).toHaveBeenCalledWith('edit', expect.objectContaining({ path: '0.0.0', tag: 'strong' }));
  });

  it('renders nothing for a reader and dismisses an open bubble when capability is removed', async () => {
    actions.update({ type: 'mx:selection-actions', edit: false, annotate: false });
    await selectText();
    expect(document.querySelector(`[${SELECTION_ACTIONS_ATTR}]`)).toBeNull();

    actions.update({ type: 'mx:selection-actions', edit: true, annotate: true });
    await selectText();
    expect(document.querySelector(`[${SELECTION_ACTIONS_ATTR}]`)).toBeTruthy();
    actions.update({ type: 'mx:selection-actions', edit: false, annotate: false });
    expect(document.querySelector(`[${SELECTION_ACTIONS_ATTR}]`)).toBeNull();
  });

  /*
   * ADDED (F4). A TOUCH SELECTION FIRES NEITHER OF THE EVENTS THE BUBBLE USED
   * TO WAIT FOR. Android takes the long-press over for its own selection UI
   * (the page sees `pointercancel` at best) and dragging the handles is browser
   * chrome that never reaches the page — so `pointerup` never comes and no key
   * is pressed. `selectionchange` is the one event every touch selection does
   * fire, and it was wired ONLY to hide: on a phone the bubble was unreachable.
   * It SHOWS now, after a settle, so a drag of the handles raises it once at
   * the end rather than chasing every intermediate selection.
   */
  it('raises the bubble for a touch selection, which fires no pointerup at all', async () => {
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: true });
    // Spend the first-update recovery microtask before the clock is frozen.
    await Promise.resolve();
    vi.useFakeTimers();
    try {
      selectRange();
      document.dispatchEvent(new Event('selectionchange'));
      expect(bubbleVisible()).toBe(false);
      vi.advanceTimersByTime(199);
      expect(bubbleVisible()).toBe(false);
      vi.advanceTimersByTime(1);
      expect(bubbleVisible()).toBe(true);

      // Collapsing still hides at once — a settle would leave the bubble over
      // words that are no longer selected.
      window.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
      expect(bubbleVisible()).toBe(false);

      // A further change RE-ARMS the settle rather than adding a second one:
      // dragging a handle changes the selection continuously, and the bubble
      // belongs where the gesture ENDED.
      selectRange();
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(150);
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(150);
      expect(bubbleVisible()).toBe(false);
      vi.advanceTimersByTime(50);
      expect(bubbleVisible()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  /*
   * ADDED (F4). ABOVE THE SELECTION IS EXACTLY WHERE A PHONE DRAWS ITS OWN
   * Copy/Share menu, and the bounding box of a multi-line selection starts at
   * its FIRST line — so the old placement put our bubble under the native menu
   * and nowhere near the words the thumb just finished on. On a coarse pointer
   * it hangs below the LAST client rect instead, and its buttons grow to a
   * 44px touch target.
   */
  it('hangs below the last line of the selection on a coarse pointer, with touch-sized buttons', async () => {
    // jsdom implements no matchMedia at all, which is why the module asks for
    // it optionally — a document rendered where the query cannot be answered
    // keeps the fine-pointer placement.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: true });

    const text = document.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(text);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => ({ ...rangeRect, toJSON: () => ({}) }),
    });
    // Two lines: the words wrap, and the gesture ended on the second one.
    Object.defineProperty(range, 'getClientRects', {
      value: () => [
        { x: 100, y: 80, left: 100, top: 80, right: 240, bottom: 100, width: 140, height: 20, toJSON: () => ({}) },
        { x: 100, y: 104, left: 100, top: 104, right: 180, bottom: 124, width: 80, height: 20, toJSON: () => ({}) },
      ],
    });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('p')!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await Promise.resolve();

    const toolbar = document.querySelector<HTMLElement>(`[${SELECTION_ACTIONS_ATTR}]`)!;
    expect(toolbar).not.toHaveAttribute('hidden');
    // Below the SECOND rect's bottom, not above the first rect's top.
    expect(toolbar.style.top).toBe('131px');
    expect(toolbar.style.transform).toBe('translate(-50%, 0)');
    expect(toolbar.style.left).toBe('140px');
    const buttons = [...toolbar.querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.classList.contains(SELECTION_ACTION_COARSE_CLASS))).toBe(true);
  });

  it('follows the words when the document scrolls, rather than abandoning them', async () => {
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: true });
    await selectText();
    const toolbar = document.querySelector<HTMLElement>(`[${SELECTION_ACTIONS_ATTR}]`)!;
    expect(toolbar.style.top).toBe('73px');

    // The reader scrolls a little: the same words, 40px higher. A bubble that
    // hid here would be gone until the next click, for a gesture that never
    // changed what is selected.
    rangeRect = { ...rangeRect, y: 40, top: 40, bottom: 60 };
    window.dispatchEvent(new Event('scroll'));
    await vi.waitFor(() => expect(toolbar.style.top).toBe('33px'));
    expect(toolbar).not.toHaveAttribute('hidden');
  });

  it('re-measures for keys that can move a selection, and for nothing else', async () => {
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: true });
    await selectText();
    const look = vi.spyOn(window, 'getSelection');

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'q', bubbles: true }));
    expect(look).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    expect(look).toHaveBeenCalled();
  });
});
