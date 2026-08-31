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
