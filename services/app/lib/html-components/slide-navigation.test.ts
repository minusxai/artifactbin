import { describe, expect, it } from 'vitest';
import { slideIndex, slideKeyIndex, visibleSlideIndex } from './slide-navigation';
describe('slide navigation contract',()=>{
  it('clamps finite selections and gives empty decks no selected slide',()=>{
    expect(slideIndex(3,0)).toBe(-1);expect(slideIndex(-10,3)).toBe(0);expect(slideIndex(8,3)).toBe(2);expect(slideIndex(1.8,3)).toBe(1);expect(slideIndex(NaN,3)).toBe(0);
  });
  it('retains paging keys with clamped boundaries and explicit endpoints',()=>{
    for(const key of ['ArrowRight','PageDown',' '])expect(slideKeyIndex(key,1,3)).toBe(2);
    for(const key of ['ArrowLeft','PageUp'])expect(slideKeyIndex(key,1,3)).toBe(0);
    expect(slideKeyIndex('Home',2,3)).toBe(0);expect(slideKeyIndex('End',0,3)).toBe(2);
    expect(slideKeyIndex('ArrowRight',2,3)).toBe(2);expect(slideKeyIndex('ArrowLeft',0,3)).toBe(0);expect(slideKeyIndex('x',0,3)).toBeNull();expect(slideKeyIndex('End',0,0)).toBe(-1);
  });
  it('tracks the last slide above the viewport reading mark',()=>{
    expect(visibleSlideIndex([],200)).toBe(-1);expect(visibleSlideIndex([500,1000],200)).toBe(0);expect(visibleSlideIndex([-800,10,900],200)).toBe(1);
  });
});
