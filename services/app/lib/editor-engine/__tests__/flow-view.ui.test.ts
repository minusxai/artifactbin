/**
 * The mounted prose view (flow-view): typing is held and handed to the page once it pauses (FLOW_IDLE_MS) or when
 * flushed, a path redraw runs in steps, a bookmark restores the caret, and the chrome selectors name what the
 * engine draws. jsdom: the view needs a document.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseJsx, serializeJsx, type JsxNode } from '@/lib/jsx';
import { FLOW_IDLE_MS, flushFlowView, mountFlowView, repathFlowView, type FlowView } from '../flow-view';
import { restoreBookmark } from '../bookmark';
import { HOVER_GRIP_ATTR, NODE_CHROME_SELECTOR } from '../node-chrome';

const nodesOf = (source: string): JsxNode[] => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.nodes;
};
let flow: FlowView | undefined;
afterEach(() => { flow?.destroy(); flow = undefined; document.body.innerHTML = ''; vi.useRealTimers(); });

function mount(source = '<p id="p1">hello</p><p id="p2">world</p>') {
  const changes: string[] = [];
  const host = document.createElement('div');
  document.body.append(host);
  const props = { nodes: nodesOf(source), path: '0', onChange: (nodes: JsxNode[]) => { changes.push(serializeJsx(nodes)); } };
  flow = mountFlowView(host, () => props, () => {});
  return { flow, changes, host };
}

describe('flow view', () => {
  it('holds typing until it pauses for FLOW_IDLE_MS, then hands the region to the page once', () => {
    vi.useFakeTimers();
    const { flow, changes } = mount();
    expect(FLOW_IDLE_MS).toBe(200);
    flow.view.dispatch(flow.view.state.tr.insertText('!', 6));
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(FLOW_IDLE_MS - 1);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual(['<p id="p1">hello!</p><p id="p2">world</p>']);
    vi.advanceTimersByTime(FLOW_IDLE_MS * 5);
    expect(changes).toHaveLength(1);
  });

  it('flushFlowView hands held typing over now, and is a no-op with nothing held or for a foreign view', () => {
    const { flow, changes } = mount();
    flushFlowView(flow.view);
    expect(changes).toEqual([]);
    flow.view.dispatch(flow.view.state.tr.insertText('é👩', 1));
    flushFlowView(flow.view);
    expect(changes).toEqual(['<p id="p1">é👩hello</p><p id="p2">world</p>']);
    flushFlowView(flow.view);
    expect(changes).toHaveLength(1);
    expect(() => flushFlowView({} as never)).not.toThrow();
  });

  it('repathFlowView returns the redraw steps of a mounted view, none for any other', () => {
    const { flow } = mount();
    const steps = repathFlowView(flow.view, '3');
    expect(Array.isArray(steps)).toBe(true);
    for (const step of steps) step();
    expect(repathFlowView({} as never, '3')).toEqual([]);
  });

  it('restoreBookmark puts the caret back by source id, and refuses a gone id or a destroyed view', () => {
    const { flow: mounted } = mount();
    expect(restoreBookmark(mounted.view, { anchor: { id: 'p2', offset: 1 }, head: { id: 'p2', offset: 3 } })).toBe(true);
    expect(mounted.view.state.doc.textBetween(mounted.view.state.selection.from, mounted.view.state.selection.to)).toBe('or');
    expect(restoreBookmark(mounted.view, { anchor: { id: 'gone', offset: 0 }, head: { id: 'p2', offset: 0 } })).toBe(false);
    const view = mounted.view;
    mounted.destroy(); flow = undefined;
    expect(restoreBookmark(view, { anchor: { id: 'p1', offset: 0 }, head: { id: 'p1', offset: 0 } })).toBe(false);
  });
});

describe('node chrome selectors', () => {
  it('match every element the chrome draws, and no document element', () => {
    expect(HOVER_GRIP_ATTR).toBe('data-mx-hover-grip');
    document.body.innerHTML = `<button ${HOVER_GRIP_ATTR}></button><div data-mx-node-chrome></div><p data-mx-ast="0">doc</p>`;
    expect([...document.querySelectorAll(NODE_CHROME_SELECTOR)].map((el) => el.tagName)).toEqual(['BUTTON', 'DIV']);
  });
});
