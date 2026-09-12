/**
 * WHERE A COMMENT IS ON SCREEN — the layout report the page's cards follow,
 * and the paint that marks the words themselves. The tint over a whole node is
 * the fallback for a quote whose words are gone or only half-survive; a live
 * adopt rebuilds the highlight, because a Range does not follow a replaced
 * text node.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFrameAnnotateSession } from '@/lib/story-runtime/edit/annotate';
import { STORY_ANNOTATION_HOVER_MESSAGE, STORY_SELECTION_MESSAGE } from '@/lib/story-runtime/contract';
import { NONCE, PIN, channel, disposeAnnotateSession, env, installAnnotateSession, layouts, state } from '@/test/helpers/annotate-session';

beforeEach(installAnnotateSession);
afterEach(disposeAnnotateSession);

describe('view-mode annotation geometry', () => {
  it('owns its stylesheet by reference and restricts picking to the inline artifact root', () => {
    env.session.dispose();
    const root=document.querySelector('main')!;
    const unrelated=document.createElement('style');
    unrelated.setAttribute('data-mx-annotate-css','');unrelated.textContent='.unrelated{color:red}';document.head.appendChild(unrelated);
    env.session=createFrameAnnotateSession({win:window,root,channel:channel(),isEditing:()=>false});
    try {
      env.session.update({...state('on'),pick:'block'});
      expect(unrelated.textContent).toBe('.unrelated{color:red}');
      expect(root).toHaveAttribute('data-mx-annotate-picking','block');
      expect(document.documentElement).not.toHaveAttribute('data-mx-annotate-picking');
      env.session.dispose();expect(unrelated.isConnected).toBe(true);
    } finally {unrelated.remove();}
  });
  it('resolves persisted source IDs without requiring legacy anchor attributes', () => {
    const anchor = document.querySelector('main p')!;
    anchor.removeAttribute('data-annotation-anchor');
    anchor.id = 'node-1';
    anchor.setAttribute('data-mx-ast', '9');
    env.session.update({ ...state('on'), pins: [{ ...PIN, nodeId: 'node-1' }] });
    expect(layouts().at(-1)).toMatchObject({
      positions: [{ id: PIN.id, rect: { x: 40, y: 220, width: 300, height: 28 } }],
    });
    expect(anchor).toHaveAttribute('data-mx-annotated');
  });

  it('does not attach a durable pin to the node that inherits a removed target path', () => {
    const anchor = document.querySelector('main p')!;
    anchor.removeAttribute('data-annotation-anchor');
    anchor.id = 'path-successor';
    env.session.update({ ...state('on'), pins: [{ ...PIN, nodeId: 'node-1' }] });
    expect(layouts().at(-1)).toMatchObject({ positions: [] });
    expect(anchor).not.toHaveAttribute('data-mx-annotated');
  });

  it('uses the main document anchor rather than a deck thumbnail copy, and refreshes it on scroll', () => {
    env.session.update(state('on'));
    expect(layouts().at(-1)).toMatchObject({
      nonce: NONCE,
      positions: [{ id: 'ann_1', rect: { x: 40, y: 220, width: 300, height: 28 } }],
    });

    env.y = 90;
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
    env.editing = true;
    env.session.update(state('on'));
    expect(layouts().at(-1)).toMatchObject({
      positions: [{ id: 'ann_1', rect: { y: 220 } }],
    });
    expect(document.querySelector('main p')).toHaveAttribute('data-mx-annotated');
  });

  it('tints commented nodes whenever the layer is on, and stops when it is off', () => {
    env.session.update(state('on'));
    expect(document.querySelector('main p')).toHaveAttribute('data-mx-annotated');
    // the deck thumbnail is chrome, never the annotated copy
    expect(document.querySelector('.mx-rail p')).not.toHaveAttribute('data-mx-annotated');

    env.session.update(state('off'));
    expect(document.querySelector('main p')).not.toHaveAttribute('data-mx-annotated');
    expect(layouts().at(-1)).toMatchObject({ positions: [] });
  });

  /*
   * Typing inside an editable host does not re-render (the engine commits on
   * blur), so text reflows under a card that never hears about it.
   */
  it('re-reports geometry on input, not only on scroll and re-render', () => {
    env.session.update(state('on'));
    const before = layouts().length;
    env.y = 44;
    document.querySelector('main p')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(layouts().length).toBeGreaterThan(before);
    expect(layouts().at(-1)).toMatchObject({ positions: [{ id: 'ann_1', rect: { y: 44 } }] });
  });

  it('leaves commented text clicks to native selection in view and edit modes', () => {
    env.session.update(state('on'));
    for (const edit of [false, true]) {
      env.editing = edit;
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      document.querySelector('main p')!.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(false);
    }
    expect(env.posted.filter((m) => m.type === 'mx:annotation-pin')).toHaveLength(0);
  });

  it('outlines only the main anchor named by a card hover', () => {
    env.session.update({ ...state('on'), hoverId: PIN.id });
    expect(document.querySelector('main p')).toHaveAttribute('data-mx-annotation-hover');
    expect(document.querySelector('.mx-rail p')).not.toHaveAttribute('data-mx-annotation-hover');

    env.session.update(state('on'));
    expect(document.querySelector('main p')).not.toHaveAttribute('data-mx-annotation-hover');
  });

  it('reports annotated document-node hover back to the page', () => {
    env.session.update(state('on'));
    const anchor = document.querySelector('main p')!;
    anchor.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(env.posted.at(-1)).toMatchObject({ type: STORY_ANNOTATION_HOVER_MESSAGE, nonce: NONCE, id: PIN.id });

    anchor.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
    expect(env.posted.at(-1)).toMatchObject({ type: STORY_ANNOTATION_HOVER_MESSAGE, nonce: NONCE, id: null });
  });

  it('refreshes the selected node geometry while an on-page composer is open', () => {
    env.session.setNodes([{
      type: 'element', tag: 'p', isComponent: false, attributes: [], children: [], selfClosing: false, start: 0, end: 0,
    }]);
    env.session.update({ ...state('on'), selectedPath: '0' });
    expect(env.posted.filter((message) => message.type === STORY_SELECTION_MESSAGE).at(-1)).toMatchObject({
      selection: { path: '0', rect: { y: 220 } },
    });

    env.y = 72;
    window.dispatchEvent(new Event('scroll'));
    expect(env.posted.filter((message) => message.type === STORY_SELECTION_MESSAGE).at(-1)).toMatchObject({
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
    env.session.update({ ...state('on'), pins: [rangedPin('Revenue')] });

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
    env.session.update({ ...state('on'), pins: [rangedPin('Margins')] });
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
    env.session.update({ ...state('on'), pins: [{ ...PIN, range: { v: 1 as const, parts: [
      { rel: '', start: 24, end: 38, text: 'ahead of plan.' },   // written away
      { rel: '+1', start: 0, end: 13, text: 'Costs fell 8%' },   // still there
    ] } }] });
    const anchor = document.querySelector('[data-annotation-anchor="anchor_1"]')!;
    expect(registry.has('mx-annotation-ann_1')).toBe(false);
    expect(anchor.hasAttribute('data-mx-annotated')).toBe(true);
    expect(anchor.hasAttribute('data-mx-annotation-ranged')).toBe(false);
  });

  it('falls back to the tint where the highlight API does not exist at all', () => {
    env.session.update({ ...state('on'), pins: [rangedPin('Revenue')] });
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
    env.session.update({ ...state('on'), pins: [rangedPin('Revenue')] });
    expect(layouts().at(-1)).toMatchObject({
      positions: [{ id: 'ann_1', rect: { x: 62, y: 226, width: 74, height: 18 } }],
    });
  });

  it('drops a highlight the moment the layer goes off', () => {
    const registry = installHighlightApi();
    env.session.update({ ...state('on'), pins: [rangedPin('Revenue')] });
    expect(registry.size).toBe(1);
    env.session.update({ ...state('off'), pins: [rangedPin('Revenue')] });
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
    env.session.update({ ...state('on'), pins: [rangedPin('Revenue')] });
    const before = registry.get('mx-annotation-ann_1')!.ranges[0];
    const anchor = anchorNode();

    // What an adopt does: same element, brand new text node under it.
    anchor.replaceChildren(document.createTextNode('Revenue grew 40% in Q3'));
    // A live Range does not follow: its boundaries collapse onto the parent
    // the moment the text node it pointed into is taken away — it paints
    // nothing, and nothing says so. Hence the rebuild.
    expect(before.toString()).toBe('');
    env.session.setNodes([]);

    const after = registry.get('mx-annotation-ann_1')!.ranges[0];
    expect(after).not.toBe(before);
    expect(after.startContainer).toBe(anchor.firstChild);
    expect(after.toString()).toBe('Revenue');
  });
});
