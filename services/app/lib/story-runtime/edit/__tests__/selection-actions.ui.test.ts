import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameSelectionActions, SELECTION_ACTION_COARSE_CLASS, SELECTION_ACTIONS_ATTR } from '../selection-actions';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

const parsed = parseJsxOrThrow('<p>select these words</p>');

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
  it('keeps document actions available on right-click with selected text', async () => {
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: true });
    await selectText();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 90 });
    document.querySelector('p')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(bubbleVisible()).toBe(true);
    expect(document.querySelector('[data-mx-selection-action="annotate"]')).not.toBeNull();
    expect(document.querySelector('[data-mx-selection-action="edit"]')).not.toBeNull();
    expect(document.querySelector('[data-mx-selection-action="select"]')).not.toBeNull();
  });
  it('sends every selected table cell part with the authorized Comment action', async () => {
    const source = parseJsxOrThrow('<table><tbody><tr><td>24</td><td>Deploy npm race</td></tr>'
      + '<tr><td>25</td><td>Ask reporter to retry</td></tr></tbody></table>');
    document.body.innerHTML = '<table data-mx-ast="0"><tbody data-mx-ast="0.0">'
      + '<tr data-mx-ast="0.0.0"><td data-mx-ast="0.0.0.0">24</td><td data-mx-ast="0.0.0.1">Deploy npm race</td></tr>'
      + '<tr data-mx-ast="0.0.1"><td data-mx-ast="0.0.1.0">25</td><td data-mx-ast="0.0.1.1">Ask reporter to retry</td></tr>'
      + '</tbody></table>';
    actions.setNodes(source.nodes);
    actions.update({ type: 'mx:selection-actions', edit: false, annotate: true });
    const cells = document.querySelectorAll('td');
    const range = document.createRange();
    range.setStart(cells[0]!.firstChild!, 0);
    range.setEnd(cells[3]!.firstChild!, 'Ask reporter to retry'.length);
    Object.defineProperty(range, 'getBoundingClientRect', { value: () => ({ ...rangeRect, toJSON: () => ({}) }) });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    cells[3]!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await Promise.resolve();

    document.querySelector<HTMLButtonElement>('[data-mx-selection-action="annotate"]')!.click();
    expect(onAction).toHaveBeenCalledWith('annotate', expect.objectContaining({
      path: '0',
      tag: 'table',
      quote: '24 Deploy npm race 25 Ask reporter to retry',
      range: expect.objectContaining({
        parts: expect.arrayContaining([
          expect.objectContaining({ text: '24' }),
          expect.objectContaining({ text: 'Deploy npm race' }),
          expect.objectContaining({ text: '25' }),
          expect.objectContaining({ text: 'Ask reporter to retry' }),
        ]),
      }),
    }));
  });
  it('captures the complete comment when selected blocks share a nested source owner', async () => {
    const source = parseJsxOrThrow('<main><section><p>first nested section</p></section>'
      + '<section><p>second nested section</p></section></main>');
    document.body.innerHTML = '<main data-mx-ast="0">'
      + '<section data-mx-ast="0.0"><p data-mx-ast="0.0.0">first nested section</p></section>'
      + '<section data-mx-ast="0.1"><p data-mx-ast="0.1.0">second nested section</p></section>'
      + '</main>';
    actions.setNodes(source.nodes);
    actions.update({ type: 'mx:selection-actions', edit: false, annotate: true });
    const paragraphs = document.querySelectorAll('p');
    const range = document.createRange();
    range.setStart(paragraphs[0]!.firstChild!, 0);
    range.setEnd(paragraphs[1]!.firstChild!, 'second nested section'.length);
    Object.defineProperty(range, 'getBoundingClientRect', { value: () => ({ ...rangeRect, toJSON: () => ({}) }) });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    paragraphs[1]!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await Promise.resolve();

    document.querySelector<HTMLButtonElement>('[data-mx-selection-action="annotate"]')!.click();
    expect(onAction).toHaveBeenCalledWith('annotate', expect.objectContaining({
      path: '0',
      tag: 'main',
      quote: 'first nested section second nested section',
      range: expect.objectContaining({ parts: expect.arrayContaining([
        expect.objectContaining({ text: 'first nested section' }),
        expect.objectContaining({ text: 'second nested section' }),
      ]) }),
    }));
  });
  it('explains and blocks Comment for a selection spanning separate repeat items', async () => {
    const source = parseJsxOrThrow('<For id="orders" each={$orders}><p id="name">{$_row.name}</p></For>');
    document.body.innerHTML = '<div id="orders" data-mx-ast="0">'
      + '<p id="first" data-mx-ast="0.0">first item text</p>'
      + '<p id="second" data-mx-ast="0.0">second item text</p></div>';
    const first = document.getElementById('first')!;
    const second = document.getElementById('second')!;
    first.setAttribute('data-mx-comment-owner', 'orders');
    second.setAttribute('data-mx-comment-owner', 'orders');
    first.setAttribute('data-mx-comment-target', JSON.stringify({ kind: 'repeat', scopes: [{ nodeId: 'orders', key: 'one' }], templateNodeId: 'name' }));
    second.setAttribute('data-mx-comment-target', JSON.stringify({ kind: 'repeat', scopes: [{ nodeId: 'orders', key: 'two' }], templateNodeId: 'name' }));
    actions.setNodes(source.nodes);
    actions.update({ type: 'mx:selection-actions', edit: false, annotate: true });
    const range = document.createRange();
    range.setStart(first.firstChild!, 0);
    range.setEnd(second.firstChild!, 'second item text'.length);
    Object.defineProperty(range, 'getBoundingClientRect', { value: () => ({ ...rangeRect, toJSON: () => ({}) }) });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    second.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await Promise.resolve();

    expect(document.querySelector('[data-mx-selection-action="annotate"]')).toBeNull();
    expect(document.querySelector('[data-mx-selection-action-status]')?.textContent).toBe('Comment is unavailable for this selection.');
    expect(onAction).not.toHaveBeenCalled();
  });
  it('owns a multiline selection across document blocks on right-click', () => {
    const story = parseJsxOrThrow('<div><p>first paragraph</p><p>second paragraph</p></div>');
    document.body.innerHTML = '<div data-mx-ast="0"><p data-mx-ast="0.0">first paragraph</p>'
      + '<p data-mx-ast="0.1">second paragraph</p></div>';
    actions.setNodes(story.nodes);
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: true });

    const range = document.createRange();
    range.setStart(document.querySelector('p')!.firstChild!, 0);
    range.setEnd(document.querySelectorAll('p')[1].firstChild!, 'second paragraph'.length);
    Object.defineProperty(range, 'getBoundingClientRect', { value: () => ({ ...rangeRect, toJSON: () => ({}) }) });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.querySelectorAll('p')[1].dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(bubbleVisible()).toBe(true);
    expect(document.querySelectorAll('[data-mx-selection-action]')).toHaveLength(3);
  });
  it.each(['empty sibling', 'next text at offset zero', 'selected outside text'])('owns only selected document text across an exterior endpoint: %s', async boundary => {
    actions.dispose();
    document.body.innerHTML = '<div id="story"><p data-mx-ast="0">select these words</p></div><div id="outside"></div>';
    const root = document.getElementById('story')!;
    const outside = document.getElementById('outside')!;
    if (boundary !== 'empty sibling') outside.textContent = 'Outside';
    actions = createFrameSelectionActions({win: window, root, onAction});
    actions.setNodes(parsed.nodes);
    actions.update({type: 'mx:selection-actions', edit: false, annotate: true});
    const range = document.createRange();
    range.setStart(root.querySelector('p')!.firstChild!, 0);
    range.setEnd(outside.firstChild ?? outside, boundary === 'selected outside text' ? 1 : 0);
    const rect = () => ({...rangeRect, toJSON: () => ({})});
    Object.defineProperty(range, 'getBoundingClientRect', {value: rect});
    const clone = range.cloneRange.bind(range);
    vi.spyOn(range, 'cloneRange').mockImplementation(() => {
      const clipped = clone();
      Object.defineProperty(clipped, 'getBoundingClientRect', {value: rect});
      return clipped;
    });
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    root.querySelector('p')!.dispatchEvent(new MouseEvent('pointerup', {bubbles: true}));
    await Promise.resolve();
    if (boundary === 'selected outside text') {
      expect(bubbleVisible()).toBe(false);
      expect(onAction).not.toHaveBeenCalled();
    } else {
      expect(bubbleVisible()).toBe(true);
      expect(document.querySelector('[aria-label="Edit selected text"]')).toBeNull();
      document.querySelector<HTMLButtonElement>('[aria-label="Comment on selected text"]')!.click();
      expect(onAction).toHaveBeenCalledWith('annotate', expect.objectContaining({path: '0', quote: 'select these words'}));
    }
  });
  it('keeps the clicked shadow-portal button mounted between pointerup and click',async()=>{
    actions.dispose();
    const host=document.createElement('div');document.body.appendChild(host);
    const shadow=host.attachShadow({mode:'open'});
    const portal=document.createElement('div');shadow.appendChild(portal);
    actions=createFrameSelectionActions({win:window,portal,onAction});actions.setNodes(parsed.nodes);
    actions.update({type:'mx:selection-actions',edit:true,annotate:true});
    await selectText();
    const button=shadow.querySelector<HTMLButtonElement>('[aria-label="Comment on selected text"]')!;
    expect(button).not.toBeNull();
    button.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,composed:true}));
    button.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,composed:true}));
    await Promise.resolve();
    expect(button.isConnected).toBe(true);
    button.click();expect(onAction).toHaveBeenCalledWith('annotate',expect.objectContaining({path:'0'}));
  });
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
    const deep = parseJsxOrThrow('<div><h1>the heading that was selected</h1><div><div><p>1.0 · Build</p></div></div></div>');
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

    document.querySelector<HTMLButtonElement>('[aria-label="Comment on selected text"]')!.click();
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
    expect(toolbar.querySelector('[aria-label="Comment on selected text"]')).toBeNull();

    toolbar.querySelector<HTMLButtonElement>('[aria-label="Edit selected text"]')!.click();
    expect(onAction).toHaveBeenCalledWith('edit', expect.objectContaining({ path: '0', tag: 'p', kind: 'text' }));
    expect(toolbar).toHaveAttribute('hidden');
  });

  it('renders annotate alone for an owner without exposing edit', async () => {
    actions.update({ type: 'mx:selection-actions', edit: false, annotate: true });
    await selectText();
    const toolbar = document.querySelector<HTMLElement>(`[${SELECTION_ACTIONS_ATTR}]`)!;
    expect(toolbar.querySelector('[aria-label="Edit selected text"]')).toBeNull();
    expect(toolbar.querySelector('[aria-label="Comment on selected text"] .lucide-message-square')).toBeTruthy();
  });

  it('targets the deepest source element at the selection edges, not their outer ancestor', async () => {
    const nested = parseJsxOrThrow('<div><p><strong>inner</strong> outer</p></div>');
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
   * Edit and Annotate want DIFFERENT nodes from the same Range:
   * the editor should open on the deepest element the user touched, while a
   * comment belongs to the BLOCK that contains the whole selection — anchoring
   * a comment on the <strong> loses the rest of the sentence.
   * The words themselves travel with it.
   */
  it('annotates the BLOCK containing the selection, and carries the quote and its parts', async () => {
    const nested = parseJsxOrThrow('<div><p><strong>inner</strong> outer</p></div>');
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

    document.querySelector<HTMLButtonElement>('[aria-label="Comment on selected text"]')!.click();
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

  /*
   * …AND NOT OFF THE VIEWPORT. The bubble hangs BELOW the words, so a selection
   * at the foot of the page would put the only way to act on it out of reach.
   */
  it('keeps a touch bubble inside the foot of the viewport', async () => {
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
    document.body.innerHTML = '<p data-mx-ast="0">select these words</p>';
    // jsdom's viewport is 768 tall.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute(SELECTION_ACTIONS_ATTR)) {
        return { x: 0, y: 0, left: 0, top: 0, right: 132, bottom: 30, width: 132, height: 30, toJSON: () => ({}) };
      }
      return { x: 100, y: 660, left: 100, top: 660, right: 240, bottom: 690, width: 140, height: 30, toJSON: () => ({}) };
    });
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: true });

    const text = document.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const low = { x: 100, y: 730, left: 100, top: 730, right: 240, bottom: 760, width: 140, height: 30, toJSON: () => ({}) };
    Object.defineProperty(range, 'getBoundingClientRect', { value: () => low });
    Object.defineProperty(range, 'getClientRects', { value: () => [low] });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('p')!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await Promise.resolve();

    // Below the words would be 767; the viewport's foot (768) less an 8px margin
    // and the bubble's own 30px height is as low as it may go.
    const toolbar = document.querySelector<HTMLElement>(`[${SELECTION_ACTIONS_ATTR}]`)!;
    expect(toolbar.style.top).toBe('730px');
    expect(toolbar).not.toHaveAttribute('hidden');
  });

  /*
   * THE SETTLE IS FOR THE GESTURE THAT HAS NO OTHER EVENT.
   * A mouse drag fires `selectionchange` continuously too, so a drag that
   * pauses for the settle would raise the bubble mid-gesture — into the path of
   * the cursor it is heading for, where a release could land ON it. That never
   * becomes a wrong-target action (the drag's own last change re-arms the
   * settle and re-measures), so this is not a correctness rule: the settle
   * simply buys a MOUSE nothing, since `pointerup` already covers every mouse
   * selection and `keyup` every keyboard one.
   *
   * Tracked as a held BUTTON rather than as a `pointerType` branch: jsdom's
   * MouseEvent carries no `pointerType`, and every case above dispatches a
   * `pointerup` with no `pointerdown` before it, so the flag is simply false
   * for them.
   */
  it('does not raise the bubble mid-drag while a mouse button is held down', async () => {
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: true });
    await Promise.resolve();
    vi.useFakeTimers();
    try {
      document.querySelector('p')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      selectRange();
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(400);
      expect(bubbleVisible()).toBe(false);
    } finally {
      vi.useRealTimers();
    }

    // …and releasing shows it at once, by the path a mouse always used.
    document.querySelector('p')!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await Promise.resolve();
    expect(bubbleVisible()).toBe(true);
  });

  /*
   * …and a TOUCH gesture reports a held button for its whole duration, so the
   * gate is on the pointer as well as the button: the phone keeps its settle.
   */
  it('keeps the settle for a touch, where the same gesture reports a held button', async () => {
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
    await Promise.resolve();
    vi.useFakeTimers();
    try {
      document.querySelector('p')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      const text = document.querySelector('p')!.firstChild!;
      const range = document.createRange();
      range.selectNodeContents(text);
      const line = { ...rangeRect, toJSON: () => ({}) };
      Object.defineProperty(range, 'getBoundingClientRect', { value: () => line });
      Object.defineProperty(range, 'getClientRects', { value: () => [line] });
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(200);
      expect(bubbleVisible()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
   * A TOUCH SELECTION FIRES NEITHER `pointerup` NOR A KEY. Android takes the
   * long-press over for its own selection UI (the page sees `pointercancel` at
   * best) and dragging the handles is browser chrome that never reaches the
   * page. `selectionchange` is the one event every touch selection does fire,
   * so it SHOWS the bubble rather than only hiding it — after a settle, so a
   * drag of the handles raises it once at the end rather than chasing every
   * intermediate selection.
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
   * ABOVE THE SELECTION IS EXACTLY WHERE A PHONE DRAWS ITS OWN
   * Copy/Share menu, and the bounding box of a multi-line selection starts at
   * its FIRST line — placing the bubble there puts it under the native menu
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
    expect(buttons).toHaveLength(3);
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


describe('document context actions', () => {
  it('opens Edit, Comment and Select on right-click and activates Select without a comment', () => {
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: true });
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 90 });
    document.querySelector('p')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const toolbar = document.querySelector(`[${SELECTION_ACTIONS_ATTR}]`)!;
    expect(toolbar.querySelectorAll('button')).toHaveLength(3);
    (toolbar.querySelector('[data-mx-selection-action="select"]') as HTMLElement).click();
    expect(onAction).toHaveBeenCalledWith('select', expect.objectContaining({ path: '0' }));
  });

  it.each(['text', 'graphic', 'blank block'])('comments directly on a right-clicked %s without selecting text', (content) => {
    const source = parseJsxOrThrow('<div><p id="target">words</p></div>');
    document.body.innerHTML = '<div data-mx-ast="0"><p id="target" data-mx-ast="0.0">'
      + (content === 'graphic' ? '<svg><path /></svg>' : content === 'text' ? '<span>words</span>' : '') + '</p></div>';
    actions.setNodes(source.nodes);
    actions.update({ type: 'mx:selection-actions', edit: false, annotate: true });
    const target = document.querySelector('path, span, p')!;
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const button = document.querySelector<HTMLButtonElement>('[aria-label="Comment"]');
    expect(button).not.toBeNull();
    button!.click();
    expect(onAction).toHaveBeenCalledWith('annotate', expect.objectContaining({ path: '0.0', nodeId: 'target' }));
    expect(onAction.mock.calls[0][1].quote).toBeUndefined();
    expect(bubbleVisible()).toBe(false);
  });

  it('does not offer commenting without annotation permission', () => {
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: false });
    document.querySelector('p')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(document.querySelector('[data-mx-selection-action="annotate"]')).toBeNull();
    actions.update({ type: 'mx:selection-actions', edit: false, annotate: false });
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.querySelector('p')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(bubbleVisible()).toBe(false);
  });

  it('preserves native link and Shift+right-click menus and reader permissions', () => {
    actions.update({ type: 'mx:selection-actions', edit: false, annotate: true });
    const p = document.querySelector('p')!;
    p.innerHTML = '<a href="/">link</a>';
    for (const [target, shiftKey] of [[p.querySelector('a')!, false], [p, true]] as const) {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    p.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(document.querySelector('[data-mx-selection-action="edit"]')).toBeNull();
    expect(document.querySelector('[data-mx-selection-action="select"]')).not.toBeNull();
  });

  it('leaves native input context menus to the browser', () => {
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: true });
    document.body.innerHTML = '<input aria-label="Search" value="native input text">';
    const input = document.querySelector('input')!;
    input.setSelectionRange(0, input.value.length);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(bubbleVisible()).toBe(false);
  });
});


it('long-presses a graphic on touch and cancels a moving gesture', () => {
  vi.useFakeTimers();
  try {
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: true });
    const p = document.querySelector('p')!;
    p.innerHTML = '<svg></svg>';
    const touch = () => {
      const event = new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 80 });
      Object.defineProperty(event, 'pointerType', { value: 'touch' });
      p.querySelector('svg')!.dispatchEvent(event);
    };
    touch();
    p.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 80 }));
    vi.advanceTimersByTime(600);
    expect(bubbleVisible()).toBe(false);
    touch();
    vi.advanceTimersByTime(600);
    expect(bubbleVisible()).toBe(true);
    expect(document.querySelector('[data-mx-selection-action="select"]')).not.toBeNull();
  } finally { vi.useRealTimers(); }
});

it('keeps unkeyed repeat text feedback on the owner without a positional text range',async()=>{
 const source=parseJsxOrThrow('<For id="orders" each={$orders}><p id="name">{$_row.name}</p></For>');
 document.body.innerHTML='<div id="orders" data-mx-ast="0"><p>Alice</p><p>Bob</p></div>';
 actions.setNodes(source.nodes);actions.update({type:'mx:selection-actions',edit:false,annotate:true});
 await selectText();
 document.querySelector<HTMLButtonElement>('[aria-label="Comment on selected text"]')!.click();
 expect(onAction).toHaveBeenCalledWith('annotate',expect.objectContaining({nodeId:'orders',tag:'For',quote:'Alice'}));
 expect(onAction.mock.calls[0][1].range).toBeUndefined();
});

describe('a new version drawn in place under the selection actions', () => {
  // v1: the paragraph is the body's only node. v2 inserts one above it, so every path shifts by one.
  const v1 = parseJsxOrThrow('<p id="lede">select these words</p>');
  const v2 = parseJsxOrThrow('<h2 id="added">Inserted</h2><p id="lede">select these words</p>');
  /**
   * What the morph leaves on screen, done as the morph does it — in place: the paragraph (same id) and its words
   * are kept, a heading is inserted above it, and the paragraph is re-stamped with its v2 path.
   */
  const drawV2 = () => {
    const p = document.querySelector('p')!;
    const heading = document.createElement('h2');
    heading.setAttribute('data-mx-ast', '0');
    heading.setAttribute('data-mx-source-node-id', 'added');
    heading.textContent = 'Inserted';
    p.before(heading);
    p.setAttribute('data-mx-ast', '1');
  };
  beforeEach(() => {
    document.body.innerHTML = '<p data-mx-ast="0" data-mx-source-node-id="lede">select these words</p>';
    actions.setNodes(v1.nodes);
    actions.update({ type: 'mx:selection-actions', edit: true, annotate: true });
  });

  it('offers the bubble and the document menu again once the version\'s nodes arrive', async () => {
    drawV2();
    // The precondition the page must not leave in place: classified against the FIRST version's nodes, the new
    // DOM describes nothing — no bubble, and a right-click falls through to the browser's own menu.
    await selectText();
    expect(bubbleVisible()).toBe(false);

    actions.setNodes(v2.nodes);
    await selectText();
    expect(bubbleVisible()).toBe(true);
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 90 });
    document.querySelector('p')!.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    document.querySelector<HTMLButtonElement>('[aria-label="Comment on selected text"]')!.click();
    expect(onAction).toHaveBeenCalledWith('annotate', expect.objectContaining({ path: '1', nodeId: 'lede' }));
  });

  it('re-describes a bubble that was open when the version arrived, so its action names the node where it is now', async () => {
    await selectText();
    expect(bubbleVisible()).toBe(true);
    drawV2();
    actions.setNodes(v2.nodes);
    expect(bubbleVisible()).toBe(true);
    document.querySelector<HTMLButtonElement>('[aria-label="Edit selected text"]')!.click();
    expect(onAction).toHaveBeenCalledWith('edit', expect.objectContaining({ path: '1', nodeId: 'lede' }));
  });

  it('closes an open document menu when the version arrives: the block it named may have moved', async () => {
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 90 });
    document.querySelector('p')!.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(bubbleVisible()).toBe(true);
    drawV2();
    actions.setNodes(v2.nodes);
    expect(bubbleVisible()).toBe(false);
  });
});
