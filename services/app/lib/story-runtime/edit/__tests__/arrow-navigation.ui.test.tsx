/**
 * ARROW KEYS CROSS TEXT REGIONS. The edit session splits a document into many
 * editable regions (a ProseMirror flow per run of sibling prose, a
 * contentEditable host per card paragraph, table cell or label); the caret must
 * still travel through them as if they were one document.
 *
 * The decision (which key, which region, whether the caret is on the edge) is
 * asserted against a stubbed geometry, because jsdom has no layout. The session
 * wiring is asserted with the REAL geometry on ←/→, whose edges are textual.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { EditorView } from 'prosemirror-view';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import { createFrameEditSession } from '@/lib/story-runtime/edit/session';
import { STORY_SELECTION_MESSAGE } from '@/lib/story-runtime/contract';
import {
  adjacentRegion,
  arrowDirection,
  collectTextRegions,
  navigateAcrossRegions,
  type ArrowDirection,
  type RegionGeometry,
  type TextRegion,
} from '@/lib/story-runtime/edit/arrow-navigation';
import { disposeEditSessions, installEditSession, last, mount, nodesOf } from '@/test/helpers/edit-session';

beforeEach(installEditSession);
afterEach(() => {
  disposeEditSessions();
  window.getSelection()?.removeAllRanges();
});

const key = (k: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });

/** Dispatch at `target` so `event.target` is real, and hand the same event to the decision. */
const pressOn = (target: Element, k: string, init: KeyboardEventInit = {}) => {
  const event = key(k, init);
  target.dispatchEvent(event);
  return event;
};

const caretIn = (el: Element, at: 'start' | 'end' = 'end') => {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(at === 'start');
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
};

/** A geometry whose every edge answer is scripted: no layout required. */
const stubGeometry = (overrides: Partial<RegionGeometry> = {}) => {
  const geometry = {
    visible: vi.fn((_region: TextRegion) => true),
    atEdge: vi.fn((_region: TextRegion, _direction: ArrowDirection) => true),
    caretX: vi.fn((_region: TextRegion) => 123),
    enter: vi.fn((_region: TextRegion, _direction: ArrowDirection, _x: number | null) => {}),
    ...overrides,
  };
  return geometry;
};

/**
 * A document shaped like the ones that got stuck: a prose flow, a chart, two
 * card hosts, an image, another flow, and the document chrome that re-renders
 * copies of the same nodes.
 */
const build = () => {
  document.body.innerHTML = `
    <main id="scope">
      <div class="mx-prose-region"><div class="ProseMirror" contenteditable="true" id="flowA"><p>flow A</p></div></div>
      <div data-mx-ast="0.1" aria-label="Question embed"><svg></svg></div>
      <div data-mx-ast="0.2"><p data-mx-ast="0.2.0" contenteditable="true" id="cardA">card A <span data-mx-ast="0.2.0.1" contenteditable="true" id="nested">bold</span></p></div>
      <div data-mx-ast="0.3"><p data-mx-ast="0.3.0" contenteditable="true" id="cardB">card B</p></div>
      <img data-mx-ast="0.4" alt="chart" />
      <input aria-label="A control" />
      <div class="mx-prose-region"><div class="ProseMirror" contenteditable="true" id="flowB"><p>flow B</p></div></div>
      <nav class="mx-rail"><p data-mx-ast="0.3.0" contenteditable="true" id="railCopy">card B</p></nav>
      <div data-mx-node-chrome><p data-mx-ast="0.9" contenteditable="true" id="chromeCopy">chrome</p></div>
    </main>
    <p data-mx-ast="9" contenteditable="true" id="outside">outside the document</p>`;
  const byId = (id: string) => document.getElementById(id)!;
  // Views are handed over in the order they registered, which is not document order.
  const views = [byId('flowB'), byId('flowA')].map((dom) => ({ dom }) as unknown as EditorView);
  return { scope: byId('scope'), byId, views };
};

describe('which key is an arrow move', () => {
  it('maps the four plain arrows', () => {
    expect(arrowDirection(key('ArrowUp'))).toBe('up');
    expect(arrowDirection(key('ArrowDown'))).toBe('down');
    expect(arrowDirection(key('ArrowLeft'))).toBe('left');
    expect(arrowDirection(key('ArrowRight'))).toBe('right');
    expect(arrowDirection(key('Enter'))).toBeNull();
    expect(arrowDirection(key('PageDown'))).toBeNull();
  });

  it('leaves Shift (selection), Ctrl/Meta/Alt (word/line/document motion) and IME composition alone', () => {
    for (const init of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }])
      expect(arrowDirection(key('ArrowDown', init)), JSON.stringify(init)).toBeNull();
  });

  it('leaves a key some other handler (a picker, a resize handle) already took', () => {
    const event = key('ArrowDown');
    event.preventDefault();
    expect(arrowDirection(event)).toBeNull();
  });
});

describe('the regions, in reading order', () => {
  it('lists prose flows and text hosts in document order, skipping embeds, images and controls', () => {
    const { scope, byId, views } = build();
    expect(collectTextRegions(scope, views).map((r) => r.el.id)).toEqual(['flowA', 'cardA', 'cardB', 'flowB']);
    const flow = collectTextRegions(scope, views).find((r) => r.el.id === 'flowA')!;
    expect(flow.view?.dom).toBe(byId('flowA'));
    expect(collectTextRegions(scope, views).find((r) => r.el.id === 'cardA')!.view).toBeNull();
  });

  it('never lists the rail, presenter or node-chrome copies, nested hosts, or anything outside the scope', () => {
    const { scope, views } = build();
    const ids = collectTextRegions(scope, views).map((r) => r.el.id);
    for (const id of ['railCopy', 'chromeCopy', 'nested', 'outside']) expect(ids).not.toContain(id);
  });

  it('steps to the neighbour and never wraps at either end', () => {
    const order = ['a', 'b', 'c'];
    expect(adjacentRegion(order, 'b', 'down')).toBe('c');
    expect(adjacentRegion(order, 'b', 'right')).toBe('c');
    expect(adjacentRegion(order, 'b', 'up')).toBe('a');
    expect(adjacentRegion(order, 'b', 'left')).toBe('a');
    expect(adjacentRegion(order, 'c', 'down')).toBeNull();
    expect(adjacentRegion(order, 'c', 'right')).toBeNull();
    expect(adjacentRegion(order, 'a', 'up')).toBeNull();
    expect(adjacentRegion(order, 'a', 'left')).toBeNull();
    expect(adjacentRegion(order, 'z', 'down')).toBeNull();
  });
});

describe('crossing a boundary', () => {
  const setup = (from: string, at: 'start' | 'end' = 'end') => {
    const { scope, byId, views } = build();
    const regions = collectTextRegions(scope, views);
    const selection = caretIn(byId(from), at);
    return { byId, regions, selection, region: (id: string) => regions.find((r) => r.el.id === id)! };
  };

  it('↓ on the last line enters the NEXT text region, carrying the caret x, skipping the chart between', () => {
    const { byId, regions, selection, region } = setup('flowA');
    const geometry = stubGeometry();
    const event = pressOn(byId('flowA').firstChild!.firstChild!.parentElement!, 'ArrowDown');
    expect(navigateAcrossRegions(event, { regions, selection, geometry })).toBe(true);
    expect(geometry.atEdge).toHaveBeenCalledWith(region('flowA'), 'down');
    expect(geometry.enter).toHaveBeenCalledWith(region('cardA'), 'down', 123);
    expect(event.defaultPrevented).toBe(true);
  });

  it('↑ on the first line enters the PREVIOUS region; the image between two flows is skipped', () => {
    const { byId, regions, selection, region } = setup('flowB', 'start');
    const geometry = stubGeometry();
    const event = pressOn(byId('flowB'), 'ArrowUp');
    expect(navigateAcrossRegions(event, { regions, selection, geometry })).toBe(true);
    expect(geometry.enter).toHaveBeenCalledWith(region('cardB'), 'up', 123);
  });

  it('← at the very start and → at the very end move to the neighbour\'s end and start, with no goal x', () => {
    let { byId, regions, selection, region } = setup('cardB', 'start');
    let geometry = stubGeometry();
    expect(navigateAcrossRegions(pressOn(byId('cardB'), 'ArrowLeft'), { regions, selection, geometry })).toBe(true);
    expect(geometry.enter).toHaveBeenCalledWith(region('cardA'), 'left', null);
    expect(geometry.caretX).not.toHaveBeenCalled();
    ({ byId, regions, selection, region } = setup('cardB'));
    geometry = stubGeometry();
    expect(navigateAcrossRegions(pressOn(byId('cardB'), 'ArrowRight'), { regions, selection, geometry })).toBe(true);
    expect(geometry.enter).toHaveBeenCalledWith(region('flowB'), 'right', null);
  });

  it('host to host: card A ↓ card B', () => {
    const { byId, regions, selection, region } = setup('cardA');
    const geometry = stubGeometry();
    expect(navigateAcrossRegions(pressOn(byId('cardA'), 'ArrowDown'), { regions, selection, geometry })).toBe(true);
    expect(geometry.enter).toHaveBeenCalledWith(region('cardB'), 'down', 123);
  });

  it('never interferes inside a region: not on the edge line means the browser moves the caret', () => {
    const { byId, regions, selection } = setup('cardA');
    const geometry = stubGeometry({ atEdge: vi.fn(() => false) });
    const event = pressOn(byId('cardA'), 'ArrowDown');
    expect(navigateAcrossRegions(event, { regions, selection, geometry })).toBe(false);
    expect(geometry.enter).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not wrap: ↓ in the last region and ↑ in the first are left to the browser', () => {
    let { byId, regions, selection } = setup('flowB');
    let geometry = stubGeometry();
    let event = pressOn(byId('flowB'), 'ArrowDown');
    expect(navigateAcrossRegions(event, { regions, selection, geometry })).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    ({ byId, regions, selection } = setup('flowA', 'start'));
    geometry = stubGeometry();
    event = pressOn(byId('flowA'), 'ArrowUp');
    expect(navigateAcrossRegions(event, { regions, selection, geometry })).toBe(false);
    expect(geometry.enter).not.toHaveBeenCalled();
  });

  it('skips a region that is not rendered (a hidden slide, a collapsed section)', () => {
    const { byId, regions, selection, region } = setup('flowA');
    const geometry = stubGeometry({ visible: vi.fn((r: TextRegion) => r.el.id !== 'cardA') });
    expect(navigateAcrossRegions(pressOn(byId('flowA'), 'ArrowDown'), { regions, selection, geometry })).toBe(true);
    expect(geometry.enter).toHaveBeenCalledWith(region('cardB'), 'down', 123);
  });

  it('leaves Shift, modifiers and IME to the browser without even measuring', () => {
    for (const init of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }]) {
      const { byId, regions, selection } = setup('cardA');
      const geometry = stubGeometry();
      expect(navigateAcrossRegions(pressOn(byId('cardA'), 'ArrowDown', init), { regions, selection, geometry })).toBe(false);
      expect(geometry.atEdge).not.toHaveBeenCalled();
      expect(geometry.enter).not.toHaveBeenCalled();
    }
  });

  it('acts only on a collapsed caret', () => {
    const { byId, regions } = setup('cardA');
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(byId('cardA').firstChild!, 0, byId('cardA').firstChild!, 4);
    const geometry = stubGeometry();
    expect(navigateAcrossRegions(pressOn(byId('cardA'), 'ArrowDown'), { regions, selection, geometry })).toBe(false);
    expect(geometry.enter).not.toHaveBeenCalled();
  });

  it('acts only when the key was typed IN the region holding the caret (not a control, not a picker)', () => {
    const { byId, regions, selection } = setup('cardA');
    const geometry = stubGeometry();
    const input = document.querySelector('input')!;
    expect(navigateAcrossRegions(pressOn(input, 'ArrowDown'), { regions, selection, geometry })).toBe(false);
    const listbox = document.createElement('div');
    listbox.setAttribute('role', 'listbox');
    byId('cardA').appendChild(listbox);
    expect(navigateAcrossRegions(pressOn(listbox, 'ArrowDown'), { regions, selection, geometry })).toBe(false);
    expect(geometry.enter).not.toHaveBeenCalled();
  });
});

describe('the edit session wires it in', () => {
  it('→ at the end of one text host focuses the next across an embed, and the toolbar follows', () => {
    const { at } = mount('<div><p>first host</p><Question /><p>second host</p></div>');
    const first = at('0.0'),
      second = at('0.2');
    first.focus();
    caretIn(first, 'end');
    const event = pressOn(first, 'ArrowRight');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(second);
    const selection = window.getSelection()!;
    expect(selection.isCollapsed).toBe(true);
    expect(second.contains(selection.anchorNode)).toBe(true);
    const before = document.createRange();
    before.selectNodeContents(second);
    before.setEnd(selection.anchorNode!, selection.anchorOffset);
    expect(before.toString()).toBe('');
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: { path: '0.2' } });
  });

  it('← at the start of a host lands at the END of the previous one', () => {
    const { at } = mount('<div><p>first host</p><Question /><p>second host</p></div>');
    const first = at('0.0'),
      second = at('0.2');
    second.focus();
    caretIn(second, 'start');
    expect(pressOn(second, 'ArrowLeft').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const selection = window.getSelection()!;
    const after = document.createRange();
    after.selectNodeContents(first);
    after.setStart(selection.anchorNode!, selection.anchorOffset);
    expect(after.toString()).toBe('');
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: { path: '0.0' } });
  });

  it('→ in the middle of a host is the browser\'s', () => {
    const { at } = mount('<div><p>first host</p><Question /><p>second host</p></div>');
    const first = at('0.0');
    first.focus();
    window.getSelection()!.collapse(first.firstChild!, 3);
    expect(pressOn(first, 'ArrowRight').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(first);
  });

  /** Two ProseMirror flows split by a component, as the live session renders them. */
  const mountFlows = () => {
    const nodes = nodesOf('<div><p>one</p><Question /><p>two</p></div>');
    const session = createFrameEditSession({
      win: window,
      requestRender: () => {},
      channel: { nonce: 'x'.repeat(32), post: () => {}, innerHtmlOf: (el) => el.innerHTML },
    });
    session.setNodes(nodes);
    const view = render(
      <>
        {renderStoryNodes(nodes, {
          components: { Question: () => <div>chart</div> },
          decorateElement: session.decorate,
          decorateChildren: session.decorateChildren,
        })}
      </>,
    );
    const [flowOne, flowTwo] = view.getAllByRole('textbox');
    flowOne.focus();
    caretIn(flowOne.querySelector('p')!, 'end');
    fireEvent(document, new Event('selectionchange'));
    return { session, flowOne: flowOne!, flowTwo: flowTwo! };
  };

  it('→ at the end of a prose flow enters the next flow across a component', () => {
    const { session, flowOne, flowTwo } = mountFlows();
    const event = pressOn(flowOne, 'ArrowRight');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(flowTwo);
    expect(flowTwo.contains(window.getSelection()!.anchorNode)).toBe(true);
    session.dispose();
  });

  it('keeps block-selection arrows as they were', () => {
    const { session, flowOne, flowTwo } = mountFlows();
    // A drag across both flows puts the session in block selection.
    window.getSelection()!.setBaseAndExtent(flowOne.querySelector('p')!.firstChild!, 1, flowTwo.querySelector('p')!.firstChild!, 2);
    fireEvent(document, new Event('selectionchange'));
    expect(document.querySelectorAll('[data-mx-block-selected]').length).toBeGreaterThan(0);
    caretIn(flowOne.querySelector('p')!, 'end');
    const event = pressOn(flowOne, 'ArrowRight');
    expect(event.defaultPrevented).toBe(false);
    expect(flowTwo.contains(window.getSelection()!.anchorNode)).toBe(false);
    session.dispose();
  });
});
