import { connectManagedComments } from '../../managed-comment-host';
import type { ManagedCommentState } from '../../managed-comment-contract';
import type { StoryEditSelection } from '../../contract';
/**
 * The frame owns annotation geometry: the parent cannot inspect a sandboxed
 * document, so view-mode comment cards follow a signed, scroll-live layout
 * report rather than guessing from source paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameAnnotateSession } from '../annotate';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { STORY_ANNOTATION_PIN_MESSAGE as _PIN } from '../../contract';
import type { PristineChannel } from '../../pristine';
import { STORY_ANNOTATION_HOVER_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE, STORY_ANNOTATION_PIN_MESSAGE, STORY_SELECTION_MESSAGE, type StoryAnnotationsMessage } from '../../contract';

const NONCE = 'l'.repeat(32);
const PIN = { id: 'ann_1', path: '0', key: 'anchor_1' };
let posted: Array<Record<string, unknown>>;
let session: ReturnType<typeof createFrameAnnotateSession>;
let y: number;
let editing: boolean;

const channel = (): PristineChannel => ({
  nonce: NONCE,
  post: (message) => { posted.push(message as Record<string, unknown>); },
  innerHtmlOf: (el) => el.innerHTML,
  isParent: () => true,
  isFromParent: () => true,
});

const state = (mode: StoryAnnotationsMessage['mode']): StoryAnnotationsMessage => ({
  type: 'mx:annotations', mode, pins: [PIN], openId: null, hoverId: null,
});

const layouts = () => posted.filter((message) => message.type === STORY_ANNOTATION_LAYOUT_MESSAGE);

beforeEach(() => {
  posted = [];
  y = 220;
  editing = false;
  document.body.innerHTML = '<nav class="mx-rail"><p data-mx-ast="0" data-annotation-anchor="anchor_1">Thumbnail copy</p></nav>'
    + '<main><p data-mx-ast="0" data-annotation-anchor="anchor_1">Revenue</p></main>';
  const preview = document.querySelector('.mx-rail p')!;
  vi.spyOn(preview, 'getBoundingClientRect').mockImplementation(() => ({
    x: 4, y: 18, top: 18, left: 4, width: 120, height: 20,
    right: 124, bottom: 38, toJSON: () => ({}),
  }));
  const anchor = document.querySelector('main p')!;
  vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => ({
    x: 40, y, top: y, left: 40, width: 300, height: 28,
    right: 340, bottom: y + 28, toJSON: () => ({}),
  }));
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1; });
  session = createFrameAnnotateSession({ win: window, channel: channel(), isEditing: () => editing });
});

afterEach(() => {
  session.dispose();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('view-mode annotation geometry', () => {
  it('owns its stylesheet by reference and restricts picking to the inline artifact root', () => {
    session.dispose();
    const root=document.querySelector('main')!;
    const unrelated=document.createElement('style');
    unrelated.setAttribute('data-mx-annotate-css','');unrelated.textContent='.unrelated{color:red}';document.head.appendChild(unrelated);
    session=createFrameAnnotateSession({win:window,root,channel:channel(),isEditing:()=>false});
    try {
      session.update({...state('on'),pick:'block'});
      expect(unrelated.textContent).toBe('.unrelated{color:red}');
      expect(root).toHaveAttribute('data-mx-annotate-picking','block');
      expect(document.documentElement).not.toHaveAttribute('data-mx-annotate-picking');
      session.dispose();expect(unrelated.isConnected).toBe(true);
    } finally {unrelated.remove();}
  });
  it('resolves persisted source IDs without requiring legacy anchor attributes', () => {
    const anchor = document.querySelector('main p')!;
    anchor.removeAttribute('data-annotation-anchor');
    anchor.id = 'node-1';
    anchor.setAttribute('data-mx-ast', '9');
    session.update({ ...state('on'), pins: [{ ...PIN, nodeId: 'node-1' }] });
    expect(layouts().at(-1)).toMatchObject({
      positions: [{ id: PIN.id, rect: { x: 40, y: 220, width: 300, height: 28 } }],
    });
    expect(anchor).toHaveAttribute('data-mx-annotated');
  });

  it('does not attach a durable pin to the node that inherits a removed target path', () => {
    const anchor = document.querySelector('main p')!;
    anchor.removeAttribute('data-annotation-anchor');
    anchor.id = 'path-successor';
    session.update({ ...state('on'), pins: [{ ...PIN, nodeId: 'node-1' }] });
    expect(layouts().at(-1)).toMatchObject({ positions: [] });
    expect(anchor).not.toHaveAttribute('data-mx-annotated');
  });

  it('uses the main document anchor rather than a deck thumbnail copy, and refreshes it on scroll', () => {
    session.update(state('on'));
    expect(layouts().at(-1)).toMatchObject({
      nonce: NONCE,
      positions: [{ id: 'ann_1', rect: { x: 40, y: 220, width: 300, height: 28 } }],
    });

    y = 90;
    window.dispatchEvent(new Event('scroll'));
    expect(layouts().at(-1)).toMatchObject({ positions: [{ id: 'ann_1', rect: { y: 90 } }] });
  });

  /*
   * Geometry is reported whenever the layer is on, in EVERY mode — the frame
   * is the only thing that can measure, and the page is the only thing that
   * knows whether a rail is open. Splitting that decision across the wire is
   * what made annotate a mode in the first place.
   */
  it('keeps reporting geometry while the document is being edited', () => {
    editing = true;
    session.update(state('on'));
    expect(layouts().at(-1)).toMatchObject({
      positions: [{ id: 'ann_1', rect: { y: 220 } }],
    });
    expect(document.querySelector('main p')).toHaveAttribute('data-mx-annotated');
  });

  it('tints commented nodes whenever the layer is on, and stops when it is off', () => {
    session.update(state('on'));
    expect(document.querySelector('main p')).toHaveAttribute('data-mx-annotated');
    // the deck thumbnail is chrome, never the annotated copy
    expect(document.querySelector('.mx-rail p')).not.toHaveAttribute('data-mx-annotated');

    session.update(state('off'));
    expect(document.querySelector('main p')).not.toHaveAttribute('data-mx-annotated');
    expect(layouts().at(-1)).toMatchObject({ positions: [] });
  });

  /*
   * Typing inside an editable host does not re-render (the engine commits on
   * blur), so text reflows under a card that never hears about it.
   */
  it('re-reports geometry on input, not only on scroll and re-render', () => {
    session.update(state('on'));
    const before = layouts().length;
    y = 44;
    document.querySelector('main p')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(layouts().length).toBeGreaterThan(before);
    expect(layouts().at(-1)).toMatchObject({ positions: [{ id: 'ann_1', rect: { y: 44 } }] });
  });

  it('leaves commented text clicks to native selection in view and edit modes', () => {
    session.update(state('on'));
    for (const edit of [false, true]) {
      editing = edit;
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      document.querySelector('main p')!.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(false);
    }
    expect(posted.filter((m) => m.type === 'mx:annotation-pin')).toHaveLength(0);
  });

  it('outlines only the main anchor named by a card hover', () => {
    session.update({ ...state('on'), hoverId: PIN.id });
    expect(document.querySelector('main p')).toHaveAttribute('data-mx-annotation-hover');
    expect(document.querySelector('.mx-rail p')).not.toHaveAttribute('data-mx-annotation-hover');

    session.update(state('on'));
    expect(document.querySelector('main p')).not.toHaveAttribute('data-mx-annotation-hover');
  });

  it('reports annotated document-node hover back to the page', () => {
    session.update(state('on'));
    const anchor = document.querySelector('main p')!;
    anchor.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(posted.at(-1)).toMatchObject({ type: STORY_ANNOTATION_HOVER_MESSAGE, nonce: NONCE, id: PIN.id });

    anchor.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
    expect(posted.at(-1)).toMatchObject({ type: STORY_ANNOTATION_HOVER_MESSAGE, nonce: NONCE, id: null });
  });

  it('refreshes the selected node geometry while an on-page composer is open', () => {
    session.setNodes([{
      type: 'element', tag: 'p', isComponent: false, attributes: [], children: [], selfClosing: false, start: 0, end: 0,
    }]);
    session.update({ ...state('on'), selectedPath: '0' });
    expect(posted.filter((message) => message.type === STORY_SELECTION_MESSAGE).at(-1)).toMatchObject({
      selection: { path: '0', rect: { y: 220 } },
    });

    y = 72;
    window.dispatchEvent(new Event('scroll'));
    expect(posted.filter((message) => message.type === STORY_SELECTION_MESSAGE).at(-1)).toMatchObject({
      selection: { path: '0', rect: { y: 72 } },
    });
  });
});

/*
 * ADDED (F3). A comment now keeps the words that were selected, so the layer
 * paints THOSE rather than tinting the whole paragraph — with the CSS Custom
 * Highlight API, because injected spans would be read back as document content
 * by the editor. jsdom has neither `CSS.highlights` nor `Highlight`, which is
 * exactly the fallback this has to keep working: the tint.
 */
interface FakeHighlight { ranges: Range[] }

function installHighlightApi(): Map<string, FakeHighlight> {
  const registry = new Map<string, FakeHighlight>();
  // Assigned ONTO the real CSS object: `CSS.escape` is used all over this
  // module and a stand-in that loses it fails for the wrong reason.
  const css = window.CSS as unknown as { highlights?: unknown };
  const scope = window as unknown as { Highlight?: unknown };
  css.highlights = registry;
  scope.Highlight = class {
    ranges: Range[];
    constructor(...ranges: Range[]) { this.ranges = ranges; }
  };
  installed.push(() => { delete css.highlights; delete scope.Highlight; });
  return registry;
}
const installed: Array<() => void> = [];
afterEach(() => { while (installed.length) installed.pop()!(); });

const rangedPin = (text: string) => ({
  ...PIN,
  range: { v: 1 as const, parts: [{ rel: '', start: 0, end: text.length, text }] },
});
const anchorNode = () => document.querySelector('main p')!;

describe('painting the exact words', () => {
  it('registers one highlight per thread over the selected words, and stops tinting the whole node', () => {
    const registry = installHighlightApi();
    session.update({ ...state('on'), pins: [rangedPin('Revenue')] });

    expect(registry.has('mx-annotation-ann_1')).toBe(true);
    expect(registry.get('mx-annotation-ann_1')!.ranges.map((r) => r.toString())).toEqual(['Revenue']);
    // The node keeps its annotation attributes for geometry and highlighting,
    // but its own background steps aside for the words' highlight.
    expect(anchorNode().hasAttribute('data-mx-annotated')).toBe(true);
    expect(anchorNode().hasAttribute('data-mx-annotation-ranged')).toBe(true);
    expect(document.head.querySelector('style[data-mx-annotate-css]')!.textContent)
      .toContain('::highlight(mx-annotation-ann_1)');
  });

  it('falls back to the whole-node tint when the words are gone', () => {
    const registry = installHighlightApi();
    session.update({ ...state('on'), pins: [rangedPin('Margins')] });
    expect(registry.has('mx-annotation-ann_1')).toBe(false);
    expect(anchorNode().hasAttribute('data-mx-annotated')).toBe(true);
    expect(anchorNode().hasAttribute('data-mx-annotation-ranged')).toBe(false);
  });

  /*
   * The wire's `quote_found` is ALL parts, not any — half a quote is not the
   * words the person selected — and the paint has to say the same thing. A
   * highlight over the surviving half would show a comment pointing at a
   * fragment while the wire calls its quote gone.
   */
  it('paints nothing when only PART of a quote survives', () => {
    const registry = installHighlightApi();
    document.body.innerHTML = '<main>'
      + '<p data-mx-ast="0" data-annotation-anchor="anchor_1">Revenue was flat in Q3, behind plan.</p>'
      + '<p data-mx-ast="1">Costs fell 8% over the same period.</p>'
      + '</main>';
    session.update({ ...state('on'), pins: [{ ...PIN, range: { v: 1 as const, parts: [
      { rel: '', start: 24, end: 38, text: 'ahead of plan.' },   // written away
      { rel: '+1', start: 0, end: 13, text: 'Costs fell 8%' },   // still there
    ] } }] });
    const anchor = document.querySelector('[data-annotation-anchor="anchor_1"]')!;
    expect(registry.has('mx-annotation-ann_1')).toBe(false);
    expect(anchor.hasAttribute('data-mx-annotated')).toBe(true);
    expect(anchor.hasAttribute('data-mx-annotation-ranged')).toBe(false);
  });

  it('falls back to the tint where the highlight API does not exist at all', () => {
    session.update({ ...state('on'), pins: [rangedPin('Revenue')] });
    expect(anchorNode().hasAttribute('data-mx-annotated')).toBe(true);
    expect(anchorNode().hasAttribute('data-mx-annotation-ranged')).toBe(false);
  });

  it('reports the words rect, not the paragraph rect, once they are found', () => {
    installHighlightApi();
    // jsdom implements no Range.getBoundingClientRect (CSSOM View); a browser
    // does, and measuring the words is the whole point of the union.
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 62, y: 226, top: 226, left: 62, width: 74, height: 18, right: 136, bottom: 244, toJSON: () => ({}) }),
    });
    installed.push(() => { delete (Range.prototype as unknown as Record<string, unknown>).getBoundingClientRect; });
    session.update({ ...state('on'), pins: [rangedPin('Revenue')] });
    expect(layouts().at(-1)).toMatchObject({
      positions: [{ id: 'ann_1', rect: { x: 62, y: 226, width: 74, height: 18 } }],
    });
  });

  it('drops a highlight the moment the layer goes off', () => {
    const registry = installHighlightApi();
    session.update({ ...state('on'), pins: [rangedPin('Revenue')] });
    expect(registry.size).toBe(1);
    session.update({ ...state('off'), pins: [rangedPin('Revenue')] });
    expect(registry.size).toBe(0);
  });
});

/*
 * ADDED (F3, after spike S3). A Highlight holds LIVE Ranges, and a live update
 * (`mx:document` → the runtime re-rendering the tree) replaces the very text
 * nodes they point into. A highlight set once therefore goes stale silently —
 * it paints nothing, and nothing says so. It is rebuilt from the stored range
 * wherever the pins are re-stamped, which is this same hook.
 */
describe('rebuilding a highlight after a live adopt', () => {
  it('re-resolves the words against the NEW text nodes', () => {
    const registry = installHighlightApi();
    session.update({ ...state('on'), pins: [rangedPin('Revenue')] });
    const before = registry.get('mx-annotation-ann_1')!.ranges[0];
    const anchor = anchorNode();

    // What an adopt does: same element, brand new text node under it.
    anchor.replaceChildren(document.createTextNode('Revenue grew 40% in Q3'));
    // A live Range does not follow: its boundaries collapse onto the parent
    // the moment the text node it pointed into is taken away — it paints
    // nothing, and nothing says so. Hence the rebuild.
    expect(before.toString()).toBe('');
    session.setNodes([]);

    const after = registry.get('mx-annotation-ann_1')!.ranges[0];
    expect(after).not.toBe(before);
    expect(after.startContainer).toBe(anchor.firstChild);
    expect(after.toString()).toBe('Revenue');
  });
});

/*
 * ADDED: PICKING A BLOCK TO COMMENT ON. The rail's pick tool puts the layer
 * into a one-shot pick — the edit-mode move, for a comment: whatever
 * selectable node is under the pointer carries an outline, and a click on it
 * IS the selection, reported as `mx:selection` so the page opens its composer
 * there. A comment made by selecting words cannot reach a chart, an image or
 * a whole list; this can. The click is TAKEN even while editing (the one
 * exception to "the click belongs to the caret"), from a WINDOW-capture
 * listener so the edit session's document-capture listener never sees it.
 * Escape hands back a null selection so the page can stand down.
 */
const PICK_NODES: JsxNode[] = [{
  type: 'element', tag: 'p', isComponent: false, attributes: [], children: [], selfClosing: false, start: 0, end: 0,
}];

describe('picking a block to comment on', () => {
  const anchor = () => document.querySelector('main p')!;
  const picking = (on: boolean) => session.update({ ...state('on'), pins: [], pick: on ? 'block' : null });
  const selections = () => posted.filter((message) => message.type === STORY_SELECTION_MESSAGE);

  it('outlines the selectable node under the pointer only while picking, and paints it', () => {
    session.setNodes(PICK_NODES);
    picking(true);
    expect(document.documentElement).toHaveAttribute('data-mx-annotate-picking');
    expect(document.head.querySelector('style[data-mx-annotate-css]')!.textContent).toContain('data-mx-annotate-pick-hover');
    anchor().dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(anchor()).toHaveAttribute('data-mx-annotate-pick-hover');
    anchor().dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
    expect(anchor()).not.toHaveAttribute('data-mx-annotate-pick-hover');

    // The outline leaves with the pick, not with the pointer.
    anchor().dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(anchor()).toHaveAttribute('data-mx-annotate-pick-hover');
    picking(false);
    expect(anchor()).not.toHaveAttribute('data-mx-annotate-pick-hover');
    expect(document.documentElement).not.toHaveAttribute('data-mx-annotate-picking');
  });

  it('outlines nothing when the layer is on but nobody is picking', () => {
    session.setNodes(PICK_NODES);
    session.update({ ...state('on'), pins: [] });
    anchor().dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(anchor()).not.toHaveAttribute('data-mx-annotate-pick-hover');
    expect(document.documentElement).not.toHaveAttribute('data-mx-annotate-picking');
  });

  it('a click while picking selects the node and reports it — even while editing, before the editor sees the click', () => {
    session.setNodes(PICK_NODES);
    editing = true;
    picking(true);
    // The edit session listens for clicks on the DOCUMENT in the capture
    // phase; a pick must be decided before that listener runs.
    const seenByEditor: string[] = [];
    const editorListener = () => seenByEditor.push('click');
    document.addEventListener('click', editorListener, true);
    try {
      const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      anchor().dispatchEvent(press);
      expect(press.defaultPrevented).toBe(true);
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      anchor().dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      expect(seenByEditor).toEqual([]);
    } finally {
      document.removeEventListener('click', editorListener, true);
    }
    expect(selections().at(-1)).toMatchObject({ nonce: NONCE, selection: { path: '0', tag: 'p' } });
    expect(anchor()).toHaveAttribute('data-mx-annotate-selected');
    expect(posted.some((message) => message.type === STORY_ANNOTATION_PIN_MESSAGE)).toBe(false);
  });

  it('in view mode the press is left alone, and a drag that selected words is NOT a pick', () => {
    session.setNodes(PICK_NODES);
    picking(true);
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    anchor().dispatchEvent(press);
    expect(press.defaultPrevented).toBe(false);
    // The drag ended on this node with words selected: the words are the
    // subject (the selection bubble's), not the block.
    const range = document.createRange();
    range.selectNodeContents(anchor());
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor().dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(selections()).toEqual([]);
    expect(document.documentElement).toHaveAttribute('data-mx-annotate-picking');
    window.getSelection()!.removeAllRanges();
  });

  it('a click on an already-commented node while picking is a NEW selection, never a thread focus', () => {
    session.setNodes(PICK_NODES);
    session.update({ ...state('on'), pick: 'block' }); // PIN sits on this very node
    expect(anchor()).toHaveAttribute('data-mx-annotated');
    anchor().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(posted.some((message) => message.type === STORY_ANNOTATION_PIN_MESSAGE)).toBe(false);
    expect(selections().at(-1)).toMatchObject({ selection: { path: '0' } });
  });

  it('never picks through deck chrome, and a click on nothing selectable picks nothing', () => {
    session.setNodes(PICK_NODES);
    picking(true);
    document.querySelector('.mx-rail p')!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(document.querySelector('.mx-rail p')).not.toHaveAttribute('data-mx-annotate-pick-hover');
    document.querySelector('.mx-rail p')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(selections()).toEqual([]);
    // …and the pick is still on: nothing was picked, so nothing ended it.
    expect(document.documentElement).toHaveAttribute('data-mx-annotate-picking');
  });

  it('escape while picking reports a null selection so the page can stand down', () => {
    session.setNodes(PICK_NODES);
    picking(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(selections().at(-1)).toMatchObject({ nonce: NONCE, selection: null });
  });

  it('outside picking, neither escape nor a click is the layer\'s business', () => {
    session.setNodes(PICK_NODES);
    session.update({ ...state('on'), pins: [] });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor().dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(selections()).toEqual([]);
  });
});

/*
 * ADDED: A DRAWN AREA. The rail's second tool: a rubber band over the
 * document, whose anchor is the lowest common ancestor of the blocks it
 * touched and whose box rides the selection as an area range — the same
 * `mx:selection` answer as a block pick, with a range instead of a quote. A
 * saved area thread is painted as an overlay box where a text thread has its
 * highlight, and its layout report is the box, not the node.
 */
const AREA_SRC = '<section className="max-w-2xl"><p id="pa">Alpha</p><p id="pb">Beta</p></section>';
const areaNodes = (() => { const p = parseJsx(AREA_SRC); if (!p.ok) throw new Error('fixture does not parse'); return p.nodes; })();
const rectOf = (el: Element, r: { x: number; y: number; width: number; height: number }) =>
  vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => ({
    x: r.x, y: r.y, top: r.y, left: r.x, width: r.width, height: r.height, right: r.x + r.width, bottom: r.y + r.height, toJSON: () => ({}),
  }));
const mouse = (type: string, target: EventTarget, x: number, y: number) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));

describe('drawing an area to comment on', () => {
  const mount = () => {
    document.body.innerHTML = '<main><section data-mx-ast="0" id="sec"><p data-mx-ast="0.0" id="pa">Alpha</p><p data-mx-ast="0.1" id="pb">Beta</p></section></main>';
    rectOf(document.getElementById('sec')!, { x: 20, y: 100, width: 400, height: 200 });
    rectOf(document.getElementById('pa')!, { x: 20, y: 100, width: 400, height: 40 });
    rectOf(document.getElementById('pb')!, { x: 20, y: 160, width: 400, height: 40 });
    session.setNodes(areaNodes);
    return { sec: document.getElementById('sec')!, pa: document.getElementById('pa')!, pb: document.getElementById('pb')! };
  };
  const drawing = () => session.update({ ...state('on'), pins: [], pick: 'area' });
  const selections = () => posted.filter((message) => message.type === STORY_SELECTION_MESSAGE);
  const band = () => document.querySelector('[data-mx-annotate-band]');

  it('Select previews blocks, taps a block, and drags an area with the same tool', () => {
    const { pa, pb } = mount();
    session.update({ ...state('on'), pins: [], pick: 'select' });
    mouse('pointerover', pa, 100, 110);
    expect(pa).toHaveAttribute('data-mx-annotate-pick-hover');
    mouse('pointerdown', pa, 100, 110);
    mouse('pointerup', pa, 100, 110);
    expect(selections().at(-1)!.selection).toMatchObject({ path: '0.0' });
    mouse('pointerdown', pa, 100, 110);
    mouse('pointermove', pb, 300, 190);
    expect(pa).not.toHaveAttribute('data-mx-annotate-pick-hover');
    mouse('pointerup', pb, 300, 190);
    expect(selections().at(-1)!.selection).toMatchObject({ path: '0', range: { kind: 'area' } });
    mouse('pointerdown', pa, 100, 110);
    mouse('pointermove', pb, 300, 190);
    mouse('pointercancel', pb, 300, 190);
    expect(band()).toBeNull();
  });

  it('a drag across two paragraphs picks their section, with the band as fractions of it', () => {
    const { pa, pb } = mount();
    drawing();
    expect(document.documentElement.getAttribute('data-mx-annotate-picking')).toBe('area');
    const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 110 });
    pa.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);        // no text selection starts under a drawn area
    mouse('pointermove', pb, 300, 190);
    expect(band()).not.toBeNull();                    // the band is drawn while dragging
    // …in BLUE, apart from the amber outline of the anchor it will sit inside.
    expect((band() as HTMLElement).style.outline).toContain('59, 130, 246');
    mouse('pointerup', pb, 300, 190);
    const picked = selections().at(-1)!.selection as { path: string; tag: string; quote?: string; range?: unknown };
    expect(picked).toMatchObject({ path: '0', tag: 'section', range: { v: 1, kind: 'area', box: { x: 0.2, y: 0.05, w: 0.5, h: 0.4 } } });
    expect(picked.quote).toBeUndefined();
    expect(document.getElementById('sec')).toHaveAttribute('data-mx-annotate-selected');
    // The drawn area stays visible while its comment is composed…
    expect(band()).not.toBeNull();
    // …and leaves when the page says the selection is gone.
    session.update({ ...state('on'), pins: [], pick: null, selectedPath: null });
    expect(band()).toBeNull();
  });

  it('a click with no drag in area mode is a block pick, and a click swallows the pin focus', () => {
    const { pa } = mount();
    drawing();
    mouse('pointerdown', pa, 100, 110);
    mouse('pointerup', pa, 102, 112);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 102, clientY: 112 });
    pa.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    const picked = selections().at(-1)!.selection as { path: string; range?: unknown };
    expect(picked).toMatchObject({ path: '0.0' });
    expect(picked.range).toBeUndefined();
    expect(posted.some((message) => message.type === _PIN)).toBe(false);
  });

  it('a band over nothing picks nothing and stays in area mode', () => {
    mount();
    drawing();
    mouse('pointerdown', document.body, 100, 500);
    mouse('pointermove', document.body, 200, 600);
    mouse('pointerup', document.body, 200, 600);
    expect(selections()).toEqual([]);
    expect(band()).toBeNull();
    expect(document.documentElement.getAttribute('data-mx-annotate-picking')).toBe('area');
  });

  it('paints an area thread as an overlay box, reports the BOX as its geometry, and takes the node tint away', () => {
    mount();
    session.update({
      ...state('on'), pins: [{ id: 'ann_a', path: '0', key: 'sec', nodeId: 'sec', range: { v: 1, kind: 'area', box: { x: 0.2, y: 0.05, w: 0.5, h: 0.4 } } }],
    });
    const overlay = document.querySelector<HTMLElement>('[data-mx-annotation-area="ann_a"]')!;
    expect(overlay).not.toBeNull();
    expect(overlay.style.left).toBe('100px');
    expect(overlay.style.top).toBe('110px');
    expect(overlay.style.width).toBe('200px');
    expect(overlay.style.height).toBe('80px');
    expect(document.getElementById('sec')).toHaveAttribute('data-mx-annotated');
    expect(document.getElementById('sec')).toHaveAttribute('data-mx-annotation-ranged');
    expect(layouts().at(-1)).toMatchObject({ positions: [{ id: 'ann_a', rect: { x: 100, y: 110, width: 200, height: 80 } }] });

    session.update({ ...state('off'), pins: [] });
    expect(document.querySelector('[data-mx-annotation-area]')).toBeNull();
  });

  it('still picks on a document carrying an inline <svg> sketch, whose children are not blocks', () => {
    document.body.innerHTML = '<main><section data-mx-ast="0" id="sec"><p data-mx-ast="0.0" id="pa">Alpha</p>'
      + '<svg data-mx-ast="0.1" id="pic" class="w-6" viewBox="0 0 10 10"><circle data-mx-ast="0.1.0" id="dot" cx="5" cy="5" r="4"></circle></svg></section></main>';
    const src = '<section className="max-w-2xl"><p id="pa">Alpha</p><svg id="pic" className="w-6" viewBox="0 0 10 10"><circle id="dot" cx="5" cy="5" r="4" /></svg></section>';
    const parsed = parseJsx(src); if (!parsed.ok) throw new Error('fixture does not parse');
    session.setNodes(parsed.nodes);
    rectOf(document.getElementById('sec')!, { x: 20, y: 100, width: 400, height: 200 });
    rectOf(document.getElementById('pa')!, { x: 20, y: 100, width: 400, height: 40 });
    rectOf(document.getElementById('pic')!, { x: 20, y: 160, width: 100, height: 100 });
    rectOf(document.getElementById('dot')!, { x: 40, y: 180, width: 60, height: 60 });
    drawing();
    mouse('pointerdown', document.getElementById('pa')!, 100, 110);
    mouse('pointermove', document.getElementById('dot')!, 300, 250);
    mouse('pointerup', document.getElementById('dot')!, 300, 250);
    // The paragraph and the picture: their section. The circle inside the
    // picture is drawing, not a block, and must neither crash nor anchor.
    expect(selections().at(-1)!.selection).toMatchObject({ path: '0', tag: 'section', range: { kind: 'area' } });
  });

  it('escape while drawing stands down like a block pick', () => {
    mount();
    drawing();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(selections().at(-1)).toMatchObject({ selection: null });
  });
});

describe('runtime instance targeting', () => {
  it('resolves the exact typed row and falls back to owner after removal', () => {
    document.body.innerHTML='<div id="table" data-mx-ast="0"><table><tbody><tr><td id="cell">Alice</td><td id="other">Bob</td></tr></tbody></table></div>';
    const target={kind:'table' as const,rowKey:1,columnKey:'name'};
    const cell=document.getElementById('cell')!;cell.setAttribute('data-mx-comment-owner','table');cell.setAttribute('data-mx-comment-target',JSON.stringify(target));
    const other=document.getElementById('other')!;other.setAttribute('data-mx-comment-owner','table');other.setAttribute('data-mx-comment-target',JSON.stringify({...target,rowKey:'1'}));
    vi.spyOn(cell,'getBoundingClientRect').mockReturnValue({x:10,y:20,width:30,height:40} as DOMRect);
    const parsed=parseJsx('<DataTable id="table" rows={[]} />');if(!parsed.ok) throw Error('parse');session.setNodes(parsed.nodes);
    const message:StoryAnnotationsMessage={...state('on'),pins:[{id:'cell-comment',path:'0',key:'table',nodeId:'table',range:{v:1,kind:'target',target}}]};
    session.update(message);
    expect(layouts().at(-1)).toMatchObject({positions:[{id:'cell-comment',status:'exact',rect:{x:10,y:20}}]});
    expect(cell).toHaveAttribute('data-mx-annotated');expect(other).not.toHaveAttribute('data-mx-annotated');
    cell.remove();session.update(message);
    expect(layouts().at(-1)).toMatchObject({positions:[{id:'cell-comment',status:'missing'}]});
    expect(document.getElementById('table')).toHaveAttribute('data-mx-annotated');expect(other).not.toHaveAttribute('data-mx-annotated');
  });
});

it('replays iframe selection and preserves inner geometry when composer state returns', () => {
  document.body.innerHTML='<div id="frame" data-mx-ast="0" data-mx-managed-frame=""><div id="inner"></div></div>';
  const owner=document.getElementById('frame')!;
  vi.spyOn(owner,'getBoundingClientRect').mockReturnValue({x:100,y:200,width:400,height:300} as DOMRect);
  const parsed=parseJsx('<Iframe id="frame"><p id="static">Static</p></Iframe>');if (!parsed.ok) throw Error('parse');session.setNodes(parsed.nodes);
  session.update({...state('on'),pins:[],pick:'select'});
  const states:ManagedCommentState[]=[];
  const host=connectManagedComments(document.getElementById('inner')!, (state)=>states.push(state));
  const generation=states.at(-1)!.generation;
  host.receive({type:'comment-selection',generation,selection:{target:{kind:'key',path:['row']},rect:{x:10,y:20,width:50,height:30}}});
  const selected=posted.filter((message)=>message.type===STORY_SELECTION_MESSAGE).at(-1)!.selection as StoryEditSelection;
  expect(selected).toMatchObject({nodeId:'frame',rect:{x:110,y:220},range:{kind:'target',target:{kind:'iframe',node:{kind:'key',path:['row']}}}});
  session.update({...state('on'),pins:[],selectedPath:'0',selected});
  expect(states.at(-1)?.selection).toMatchObject({target:{kind:'key',path:['row']},rect:{x:10,y:20}});
  const count=posted.filter((message)=>message.type===STORY_SELECTION_MESSAGE).length;
  host.receive({type:'comment-selection',generation,selection:{target:{kind:'source',id:'foreign'},rect:{x:0,y:0,width:10,height:10}}});
  expect(posted.filter((message)=>message.type===STORY_SELECTION_MESSAGE)).toHaveLength(count);
  host.dispose();
});

it('opens a composer for an iframe text Comment action outside Select mode without reopening on layout', () => {
  document.body.innerHTML='<div id="frame" data-mx-ast="0" data-mx-managed-frame=""></div>';
  const owner=document.getElementById('frame')!;
  vi.spyOn(owner,'getBoundingClientRect').mockReturnValue({x:100,y:200,width:400,height:300} as DOMRect);
  const parsed=parseJsx('<Iframe id="frame"><p id="static">Static</p></Iframe>');if (!parsed.ok) throw Error('parse');session.setNodes(parsed.nodes);
  session.update({...state('on'),pins:[],pick:null,canComment:true});
  const states:ManagedCommentState[]=[];const host=connectManagedComments(owner,(state)=>states.push(state));
  const generation=states.at(-1)!.generation;
  const range={v:1,parts:[{rel:'',start:0,end:6,text:'Static'}]};
  host.receive({type:'comment-selection',generation,selection:{target:{kind:'source',id:'static'},quote:'Static',range,rect:{x:10,y:20,width:50,height:30}}});
  const actions=()=>posted.filter((message)=>message.type==='mx:selection-action');
  expect(actions()).toHaveLength(1);
  expect(actions()[0]).toMatchObject({action:'annotate',selection:{nodeId:'frame',quote:'Static',range:{kind:'target',range}}});
  host.receive({type:'comment-layout',generation,positions:[],selectionTarget:{kind:'source',id:'static'},selectionRect:{x:20,y:30,width:50,height:30}});
  expect(actions()).toHaveLength(1);
  expect(posted.filter((message)=>message.type===STORY_SELECTION_MESSAGE).at(-1)).toMatchObject({selection:{rect:{x:120,y:230}}});
  session.update({...state('on'),pins:[],canComment:false});
  host.receive({type:'comment-selection',generation,selection:{target:{kind:'source',id:'static'},rect:{x:10,y:20,width:50,height:30}}});
  expect(actions()).toHaveLength(1);
  host.dispose();
});

it('delegates exact iframe pin paint to the child and restores owner paint when missing', () => {
  document.body.innerHTML='<div id="frame" data-mx-ast="0" data-mx-managed-frame=""></div>';
  const owner=document.getElementById('frame')!;
  vi.spyOn(owner,'getBoundingClientRect').mockReturnValue({x:100,y:200,width:400,height:300} as DOMRect);
  const parsed=parseJsx('<Iframe id="frame"><p id="static">Static</p></Iframe>');if (!parsed.ok) throw Error('parse');session.setNodes(parsed.nodes);
  const message:StoryAnnotationsMessage={...state('on'),pins:[{id:'inside',path:'0',key:'frame',nodeId:'frame',range:{v:1,kind:'target',target:{kind:'iframe',node:{kind:'source',id:'static'}}}}],openId:'inside',hoverId:'inside'};
  session.update(message);
  let generation='';const host=connectManagedComments(owner,(state)=>{generation=state.generation;});
  expect(owner).toHaveAttribute('data-mx-annotated');
  host.receive({type:'comment-layout',generation,positions:[{id:'inside',status:'exact',rect:{x:10,y:20,width:50,height:30}}]});
  expect(owner).not.toHaveAttribute('data-mx-annotated');
  expect(owner).not.toHaveAttribute('data-mx-annotation-open');
  expect(owner).not.toHaveAttribute('data-mx-annotation-hover');
  expect(layouts().at(-1)).toMatchObject({positions:[{id:'inside',status:'exact',rect:{x:110,y:220}}]});
  host.receive({type:'comment-layout',generation,positions:[{id:'inside',status:'missing',rect:{x:0,y:0,width:0,height:0}}]});
  expect(owner).toHaveAttribute('data-mx-annotated');
  expect(owner).toHaveAttribute('data-mx-annotation-open');
  expect(owner).toHaveAttribute('data-mx-annotation-hover');
  host.dispose();
});

it('retains ordinary area refinement in geometry reports for the same owner', () => {
  document.body.innerHTML='<section id="section" data-mx-ast="0"></section>';
  const owner=document.getElementById('section')!;
  rectOf(owner,{x:20,y:40,width:200,height:100});
  const parsed=parseJsx('<section id="section" />');if(!parsed.ok) throw Error('parse');session.setNodes(parsed.nodes);
  const range={v:1 as const,kind:'area' as const,box:{x:0.1,y:0.2,w:0.5,h:0.4}};
  session.update({...state('on'),pins:[],selectedPath:'0',selected:{kind:'element',path:'0',nodeId:'section',tag:'section',rect:{x:0,y:0,width:200,height:100},className:'',style:'',ancestors:[],range}});
  expect(posted.filter((message)=>message.type===STORY_SELECTION_MESSAGE).at(-1)).toMatchObject({selection:{nodeId:'section',range,rect:{x:20,y:40}}});
});

it('keeps sidebar block picking distinct from explicit iframe Select mode', () => {
  document.body.innerHTML='<div id="frame" data-mx-ast="0" data-mx-managed-frame=""></div>';
  const parsed=parseJsx('<Iframe id="frame"><p id="static">Static</p></Iframe>');
  if(!parsed.ok) throw Error('parse'); session.setNodes(parsed.nodes);
  const states:ManagedCommentState[]=[];
  const host=connectManagedComments(document.getElementById('frame')!,next=>states.push(next));
  session.update({...state('on'),pins:[],pick:'block'});
  expect(states.at(-1)).toMatchObject({picking:false,blockPicking:true});
  session.update({...state('on'),pins:[],pick:'select'});
  expect(states.at(-1)).toMatchObject({picking:true,blockPicking:false});
  session.update({...state('on'),pins:[],pick:null});
  expect(states.at(-1)).toMatchObject({picking:false,blockPicking:false,selection:null});
  host.dispose();
});

it('does not let a previous iframe draft geometry finish a fresh Select or replace a second comment', () => {
  document.body.innerHTML='<div id="frame" data-mx-ast="0" data-mx-managed-frame=""></div>';
  const owner=document.getElementById('frame')!;rectOf(owner,{x:100,y:200,width:400,height:300});
  const parsed=parseJsx('<Iframe id="frame"><p id="static">Static</p></Iframe>');if(!parsed.ok) throw Error('parse');session.setNodes(parsed.nodes);
  const selected:StoryEditSelection={kind:'embed',path:'0',nodeId:'frame',tag:'Iframe',rect:{x:110,y:220,width:50,height:30},className:'',style:'',ancestors:[],range:{v:1,kind:'target',target:{kind:'iframe',node:{kind:'key',path:['first']}}}};
  session.update({...state('on'),pins:[],selectedPath:'0',selected,pick:null});
  const states:ManagedCommentState[]=[];const host=connectManagedComments(owner,next=>states.push(next));const generation=states.at(-1)!.generation;
  posted=[];
  session.update({...state('on'),pins:[],selectedPath:'0',selected,pick:'select'});
  expect(states.at(-1)?.selection).toBeNull();
  host.receive({type:'comment-layout',generation,positions:[],selectionTarget:{kind:'key',path:['first']},selectionRect:{x:10,y:20,width:50,height:30}});
  expect(posted.filter(message=>message.type===STORY_SELECTION_MESSAGE)).toHaveLength(0);
  host.receive({type:'comment-selection',generation,selection:{target:{kind:'key',path:['second']},rect:{x:50,y:60,width:50,height:30}}});
  expect(posted.filter(message=>message.type===STORY_SELECTION_MESSAGE).at(-1)).toMatchObject({selection:{range:{target:{node:{path:['second']}}}}});
  const second=posted.filter(message=>message.type===STORY_SELECTION_MESSAGE).at(-1)!.selection as StoryEditSelection;
  session.update({...state('on'),pins:[],selectedPath:'0',selected:second,pick:null});
  posted=[];
  host.receive({type:'comment-layout',generation,positions:[],selectionTarget:{kind:'key',path:['first']},selectionRect:{x:1,y:2,width:50,height:30}});
  expect(posted.filter(message=>message.type===STORY_SELECTION_MESSAGE)).toHaveLength(0);
  host.receive({type:'comment-layout',generation,positions:[],selectionTarget:{kind:'key',path:['second']},selectionRect:{x:70,y:80,width:50,height:30}});
  expect(posted.filter(message=>message.type===STORY_SELECTION_MESSAGE).at(-1)).toMatchObject({selection:{rect:{x:170,y:280},range:{target:{node:{path:['second']}}}}});
  session.update({...state('on'),pins:[],selectedPath:null,selected:null,pick:null,openId:'saved-second'});
  expect(states.at(-1)?.selection).toBeNull();
  posted=[];
  host.receive({type:'comment-layout',generation,positions:[],selectionTarget:{kind:'key',path:['first']},selectionRect:{x:10,y:20,width:50,height:30}});
  expect(posted.filter(message=>message.type===STORY_SELECTION_MESSAGE)).toHaveLength(0);
  host.receive({type:'comment-selection',generation,selection:{target:{kind:'key',path:['third']},rect:{x:80,y:90,width:50,height:30}}});
  expect(posted.filter(message=>message.type==='mx:selection-action').at(-1)).toMatchObject({action:'annotate',selection:{range:{target:{node:{path:['third']}}}}});
  host.dispose();
});
