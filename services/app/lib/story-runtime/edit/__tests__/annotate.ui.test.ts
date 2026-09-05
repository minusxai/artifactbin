/**
 * The frame owns annotation geometry: the parent cannot inspect a sandboxed
 * document, so view-mode comment cards follow a signed, scroll-live layout
 * report rather than guessing from source paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameAnnotateSession } from '../annotate';
import type { PristineChannel } from '../../pristine';
import { STORY_ANNOTATION_HOVER_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE, STORY_SELECTION_MESSAGE, type StoryAnnotationsMessage } from '../../contract';

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
  it('resolves persisted source IDs without requiring legacy anchor attributes', () => {
    const anchor = document.querySelector('main p')!;
    anchor.removeAttribute('data-annotation-anchor');
    anchor.id = PIN.key;
    anchor.setAttribute('data-mx-ast', '9');
    session.update(state('on'));
    expect(layouts().at(-1)).toMatchObject({
      positions: [{ id: PIN.id, rect: { x: 40, y: 220, width: 300, height: 28 } }],
    });
    expect(anchor).toHaveAttribute('data-mx-annotated');
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

  /*
   * A click on a commented node focuses its thread — but never while editing,
   * where that click belongs to the caret.
   */
  it('focuses a thread on click, and yields the click to the editor while editing', () => {
    session.update(state('on'));
    document.querySelector('main p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(posted.filter((m) => m.type === 'mx:annotation-pin').length).toBe(1);

    editing = true;
    document.querySelector('main p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(posted.filter((m) => m.type === 'mx:annotation-pin').length).toBe(1);
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
    // The node keeps its behaviour attributes — a click on it still opens the
    // thread — but its own background steps aside for the words' highlight.
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
