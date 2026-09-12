/**
 * THE SELECT TOOL INSIDE THE DOCUMENT — the frame half of picking. A block
 * under the pointer outlines and a click on it IS the selection; a rubber band
 * draws an area whose anchor is the blocks' lowest common ancestor. Escape
 * hands back a null selection so the page can stand down.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { type JsxNode } from '@/lib/jsx';
import { STORY_ANNOTATION_PIN_MESSAGE, STORY_SELECTION_MESSAGE } from '@/lib/story-runtime/contract';
import { NONCE, disposeAnnotateSession, env, installAnnotateSession, layouts, rectOf, state } from '@/test/helpers/annotate-session';

beforeEach(installAnnotateSession);
afterEach(disposeAnnotateSession);

/*
 * ADDED: PICKING A BLOCK TO COMMENT ON. The rail's pick tool puts the layer
 * into a one-shot pick — the edit-mode move, for a comment: whatever
 * selectable node is under the pointer carries an outline, and a click on it
 * IS the selection, reported as `mx:selection` so the page opens its composer
 * there. A comment made by selecting words cannot reach a chart, an image or
 * a whole list; this can. The click is TAKEN even while editing (the one
 * exception to "the click belongs to the caret"), from a WINDOW-capture
 * listener so the edit env.session's document-capture listener never sees it.
 * Escape hands back a null selection so the page can stand down.
 */
const PICK_NODES: JsxNode[] = [{
  type: 'element', tag: 'p', isComponent: false, attributes: [], children: [], selfClosing: false, start: 0, end: 0,
}];

describe('picking a block to comment on', () => {
  const anchor = () => document.querySelector('main p')!;
  const picking = (on: boolean) => env.session.update({ ...state('on'), pins: [], pick: on ? 'block' : null });
  const selections = () => env.posted.filter((message) => message.type === STORY_SELECTION_MESSAGE);

  it('outlines the selectable node under the pointer only while picking, and paints it', () => {
    env.session.setNodes(PICK_NODES);
    picking(true);
    expect(document.documentElement).toHaveAttribute('data-mx-annotate-picking');
    expect(document.head.querySelector('style[data-mx-annotate-css]')!.textContent).toContain('data-mx-annotate-pick-hover');
    anchor().dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(anchor()).toHaveAttribute('data-mx-annotate-pick-hover');
    expect(window.getComputedStyle(anchor()).outline).toBe('1px solid rgba(245, 158, 11, 0.9)');
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
    env.session.setNodes(PICK_NODES);
    env.session.update({ ...state('on'), pins: [] });
    anchor().dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(anchor()).not.toHaveAttribute('data-mx-annotate-pick-hover');
    expect(document.documentElement).not.toHaveAttribute('data-mx-annotate-picking');
  });

  it('a click while picking selects the node and reports it — even while editing, before the editor sees the click', () => {
    env.session.setNodes(PICK_NODES);
    env.editing = true;
    picking(true);
    // The edit env.session listens for clicks on the DOCUMENT in the capture
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
    expect(env.posted.some((message) => message.type === STORY_ANNOTATION_PIN_MESSAGE)).toBe(false);
  });

  it('in view mode the press is left alone, and a drag that selected words is NOT a pick', () => {
    env.session.setNodes(PICK_NODES);
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
    env.session.setNodes(PICK_NODES);
    env.session.update({ ...state('on'), pick: 'block' }); // PIN sits on this very node
    expect(anchor()).toHaveAttribute('data-mx-annotated');
    anchor().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(env.posted.some((message) => message.type === STORY_ANNOTATION_PIN_MESSAGE)).toBe(false);
    expect(selections().at(-1)).toMatchObject({ selection: { path: '0' } });
  });

  it('never picks through deck chrome, and a click on nothing selectable picks nothing', () => {
    env.session.setNodes(PICK_NODES);
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
    env.session.setNodes(PICK_NODES);
    picking(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(selections().at(-1)).toMatchObject({ nonce: NONCE, selection: null });
  });

  it('outside picking, neither escape nor a click is the layer\'s business', () => {
    env.session.setNodes(PICK_NODES);
    env.session.update({ ...state('on'), pins: [] });
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
const areaNodes = (() => { const p = parseJsxOrThrow(AREA_SRC); return p.nodes; })();
const mouse = (type: string, target: EventTarget, x: number, y: number) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));

describe('drawing an area to comment on', () => {
  const mount = () => {
    document.body.innerHTML = '<main><section data-mx-ast="0" id="sec"><p data-mx-ast="0.0" id="pa">Alpha</p><p data-mx-ast="0.1" id="pb">Beta</p></section></main>';
    rectOf(document.getElementById('sec')!, { x: 20, y: 100, width: 400, height: 200 });
    rectOf(document.getElementById('pa')!, { x: 20, y: 100, width: 400, height: 40 });
    rectOf(document.getElementById('pb')!, { x: 20, y: 160, width: 400, height: 40 });
    env.session.setNodes(areaNodes);
    return { sec: document.getElementById('sec')!, pa: document.getElementById('pa')!, pb: document.getElementById('pb')! };
  };
  const drawing = () => env.session.update({ ...state('on'), pins: [], pick: 'area' });
  const selections = () => env.posted.filter((message) => message.type === STORY_SELECTION_MESSAGE);
  const band = () => document.querySelector('[data-mx-annotate-band]');

  it('Select previews blocks, taps a block, and drags an area with the same tool', () => {
    const { pa, pb } = mount();
    env.session.update({ ...state('on'), pins: [], pick: 'select' });
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
    env.session.update({ ...state('on'), pins: [], pick: null, selectedPath: null });
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
    expect(env.posted.some((message) => message.type === STORY_ANNOTATION_PIN_MESSAGE)).toBe(false);
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
    env.session.update({
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

    env.session.update({ ...state('off'), pins: [] });
    expect(document.querySelector('[data-mx-annotation-area]')).toBeNull();
  });

  it('still picks on a document carrying an inline <svg> sketch, whose children are not blocks', () => {
    document.body.innerHTML = '<main><section data-mx-ast="0" id="sec"><p data-mx-ast="0.0" id="pa">Alpha</p>'
      + '<svg data-mx-ast="0.1" id="pic" class="w-6" viewBox="0 0 10 10"><circle data-mx-ast="0.1.0" id="dot" cx="5" cy="5" r="4"></circle></svg></section></main>';
    const src = '<section className="max-w-2xl"><p id="pa">Alpha</p><svg id="pic" className="w-6" viewBox="0 0 10 10"><circle id="dot" cx="5" cy="5" r="4" /></svg></section>';
    const parsed = parseJsxOrThrow(src);
    env.session.setNodes(parsed.nodes);
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
