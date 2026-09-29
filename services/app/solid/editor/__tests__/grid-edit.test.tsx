/** @jsxImportSource solid-js */
/**
 * services/app/lib/story-runtime/edit/__tests__/grid-edit.ui.test.tsx, PORTED to the Solid GridEdit.
 * Same assertions; two translations: the positioned-mode marker is the component's own class
 * (`.mx-grid-positioned`, there is no `.react-grid-layout` any more), and React's `rerender` with
 * new children becomes a signal. `act()` has no Solid counterpart: updates are synchronous.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import { GridEdit, type GridTile } from '../GridEdit';

let width = 390;
let resized: (() => void) | undefined;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const tiles = (prefix: string): GridTile[] => [
  { key: 'a', path: `${prefix}.0`, rect: { x: 0, y: 0, w: 6, h: 2 }, children: () => <p>First</p> },
  { key: 'b', path: `${prefix}.1`, rect: { x: 6, y: 0, w: 6, h: 2 }, children: () => <p>Second</p> },
];
function mount(initial = tiles('0')) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} });
  const onLayout = vi.fn();
  const [current, setCurrent] = createSignal(initial);
  const view = render(() => <GridEdit cols={12} rowHeight={86} tiles={current()} onLayout={onLayout} renderFlow={() => <div>{current().map((t) => t.children())}</div>} />);
  return { ...view, onLayout, setCurrent };
}
describe('Grid edit responsive placement', () => {
  it('uses the reader stacking mode on a narrow container without changing source', () => {
    width = 390;
    const view = mount();
    expect(view.container.querySelector('.mx-grid-positioned')).toBeNull();
    expect(view.getByText('First')).toBeTruthy();
    expect(view.getByText('Second')).toBeTruthy();
    expect(view.onLayout).not.toHaveBeenCalled();
  });
  it('responds to container resizing without a window resize or source edit', () => {
    width = 900;
    const view = mount();
    expect(view.container.querySelector('.mx-grid-positioned')).not.toBeNull();
    width = 390; resized?.();
    expect(view.container.querySelector('.mx-grid-positioned')).toBeNull();
    width = 900; resized?.();
    expect(view.container.querySelector('.mx-grid-positioned')).not.toBeNull();
    expect(view.onLayout).not.toHaveBeenCalled();
  });
});

it('provides a dedicated move grip while leaving tile text outside the drag target', () => {
  width = 900;
  const view = mount();
  expect(view.getAllByRole('button', { name: /Move GridItem/ })).toHaveLength(2);
  expect(view.getByText('First').closest('.mx-grid-grip')).toBeNull();
});

it('stages keyboard tile movement, cancels with Escape and commits displaced siblings with Enter', () => {
  width = 900; const view = mount(), grip = view.getAllByRole('button', { name: /Move GridItem/ })[0]!;
  fireEvent.keyDown(grip, { key: 'ArrowRight' }); expect(view.onLayout).not.toHaveBeenCalled();
  fireEvent.keyDown(grip, { key: 'Escape' }); expect(view.onLayout).not.toHaveBeenCalled();
  fireEvent.keyDown(grip, { key: 'ArrowRight' }); fireEvent.keyDown(grip, { key: 'Enter' });
  expect(view.onLayout).toHaveBeenCalledExactlyOnceWith(expect.arrayContaining([expect.objectContaining({ path: '0.0', x: 1 }), expect.objectContaining({ path: '0.1', y: 2 })]));
});

it('retains a positioned tile when preceding source paths change', () => {
  width = 900; const view = mount(); const first = view.getByText('First');
  view.setCurrent(tiles('1'));
  expect(view.getByText('First')).toBe(first);
});

it('POINTER: a drag by the grip commits the kernel-compacted layout (the React editor delegates this to RGL)', () => {
  width = 1200; const view = mount();
  const grip = view.getAllByRole('button', { name: /Move GridItem/ })[1]!; // "Second" at x=6
  const layer = view.container.querySelector('.mx-grid-positioned')!;
  // jsdom has no PointerEvent constructor with coordinates on every build; MouseEvent-shaped init works for fireEvent.
  fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientX: 600, clientY: 10 });
  fireEvent.pointerMove(layer, { pointerId: 1, clientX: 0, clientY: 10 }); // six columns left, onto "First"
  fireEvent.pointerUp(layer, { pointerId: 1, clientX: 0, clientY: 10 });
  expect(view.onLayout).toHaveBeenCalledTimes(1);
  const moved = view.onLayout.mock.calls[0]![0] as Array<{ path: string; x: number; y: number }>;
  expect(moved).toEqual(expect.arrayContaining([expect.objectContaining({ path: '0.1', x: 0 })]));
});
