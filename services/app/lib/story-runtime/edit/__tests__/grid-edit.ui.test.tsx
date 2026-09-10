import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render,fireEvent } from '@testing-library/react';
import { GridItem } from '@/components/kit/grid';
import { GridEdit } from '../grid-edit';

let width = 390;
let resized: (() => void) | undefined;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount() {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe() {} disconnect() {}
  });
  const onLayout = vi.fn();
  const view = render(<GridEdit props={{ cols: 12, children: [
    <GridItem key="a" data-mx-ast="0.0" x={0} w={6} h={2}><p>First</p></GridItem>,
    <GridItem key="b" data-mx-ast="0.1" x={6} w={6} h={2}><p>Second</p></GridItem>,
  ] }} onLayout={onLayout} />);
  return { ...view, onLayout };
}
describe('Grid edit responsive placement', () => {
  it('uses the reader stacking mode on a narrow container without changing source', () => {
    width = 390;
    const view = mount();
    expect(view.container.querySelector('.react-grid-layout')).toBeNull();
    expect(view.getByText('First')).toBeTruthy();
    expect(view.getByText('Second')).toBeTruthy();
    expect(view.onLayout).not.toHaveBeenCalled();
  });
  it('responds to container resizing without a window resize or source edit', () => {
    width = 900;
    const view = mount();
    expect(view.container.querySelector('.react-grid-layout')).not.toBeNull();
    act(() => { width = 390; resized?.(); });
    expect(view.container.querySelector('.react-grid-layout')).toBeNull();
    act(() => { width = 900; resized?.(); });
    expect(view.container.querySelector('.react-grid-layout')).not.toBeNull();
    expect(view.onLayout).not.toHaveBeenCalled();
  });
});

it('provides a dedicated move grip while leaving tile text outside the drag target',()=> {
  width=900;
  const view=mount();
  expect(view.getAllByRole('button',{name:/Move GridItem/})).toHaveLength(2);
  expect(view.getByText('First').closest('.mx-grid-grip')).toBeNull();
});

it('stages keyboard tile movement, cancels with Escape and commits displaced siblings with Enter',()=>{
 width=900;const view=mount(),grip=view.getAllByRole('button',{name:/Move GridItem/})[0];
 fireEvent.keyDown(grip,{key:'ArrowRight'});expect(view.onLayout).not.toHaveBeenCalled();
 fireEvent.keyDown(grip,{key:'Escape'});expect(view.onLayout).not.toHaveBeenCalled();
 fireEvent.keyDown(grip,{key:'ArrowRight'});fireEvent.keyDown(grip,{key:'Enter'});
 expect(view.onLayout).toHaveBeenCalledExactlyOnceWith(expect.arrayContaining([expect.objectContaining({path:'0.0',x:1}),expect.objectContaining({path:'0.1',y:2})]));
});

it('retains a positioned tile when preceding source paths change',()=>{
 width=900;const view=mount();const first=view.getByText('First');
 view.rerender(<GridEdit props={{cols:12,children:[
 <GridItem key="a" data-mx-ast="1.0" x={0} w={6} h={2}><p>First</p></GridItem>,
 <GridItem key="b" data-mx-ast="1.1" x={6} w={6} h={2}><p>Second</p></GridItem>,
 ]}} onLayout={view.onLayout}/>);
 expect(view.getByText('First')).toBe(first);
});
