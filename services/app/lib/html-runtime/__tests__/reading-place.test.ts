// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {captureReadingPlace,readingPlace,restoreReadingPlace} from '../reading-place';

/**
 * A laid-out page jsdom does not draw: each source element's page top and height, the window's scroll, and a
 * ResizeObserver the test triggers when the page "grows".
 */
let scroll={x:0,y:0},layout:Record<string,{top:number;height:number}>={},grow:(()=>void)|null=null;
beforeEach(()=>{
 document.body.innerHTML='<h1 data-af-id="t">Title</h1><section data-af-id="s"><p data-af-id="p1">One</p><p data-af-id="p2">Two</p></section><input data-af-id="i">';
 layout={t:{top:0,height:100},s:{top:100,height:2000},p1:{top:100,height:900},p2:{top:1000,height:1100},i:{top:2100,height:20}};
 scroll={x:0,y:0};
 Object.defineProperty(window,'scrollY',{configurable:true,get:()=>scroll.y});
 Object.defineProperty(window,'scrollX',{configurable:true,get:()=>scroll.x});
 Object.defineProperty(window,'innerHeight',{configurable:true,value:800});
 vi.spyOn(window,'scrollTo').mockImplementation(((x:number,y:number)=>{scroll={x,y};}) as typeof window.scrollTo);
 vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(this:Element){
  const box=layout[this.getAttribute('data-af-id')??'']??{top:0,height:0};
  return {top:box.top-scroll.y,bottom:box.top-scroll.y+box.height,height:box.height,left:0,right:100,width:100,x:0,y:box.top-scroll.y,toJSON(){}} as DOMRect;
 });
 vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){grow=callback;}observe(){}disconnect(){grow=null;}});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();sessionStorage.clear();grow=null;});

describe('the reader\'s place across a rebuild',()=>{
 it('names the innermost source element crossing the top of the viewport, its offset, and the focused element',()=>{
  scroll.y=1050;document.querySelector('input')!.focus();
  expect(readingPlace(window,5)).toEqual({at:5,scrollX:0,scrollY:1050,anchor:{id:'p2',offset:-50},focus:'i'});
  scroll.y=0;(document.activeElement as HTMLElement).blur();
  expect(readingPlace(window,5)).toMatchObject({anchor:null,focus:null});
 });
 it('puts the reader back by the anchor once the body is parsed, follows the page as it grows, and stops at the reader\'s own move',()=>{
  vi.useFakeTimers({now:1000});
  scroll.y=1050;document.querySelector('input')!.focus();
  captureReadingPlace(window,'page-1',1000);
  (document.activeElement as HTMLElement).blur();scroll.y=0;
  // The new version put a taller element above: the same paragraph is now 300px further down.
  for(const id of ['s','p1','p2','i'])layout[id]!.top+=300;
  restoreReadingPlace(window,'page-1',2000);
  expect(scroll.y).toBe(1350);expect(document.activeElement).toBe(document.querySelector('input'));
  // Read once: a later reload of this page starts where the browser puts it.
  expect(sessionStorage.getItem('afbin:reading-place:page-1')).toBeNull();
  // A chart drew after its data arrived.
  layout.p2!.top+=200;grow!();expect(scroll.y).toBe(1550);
  window.dispatchEvent(new Event('wheel'));
  layout.p2!.top+=200;grow?.();expect(scroll.y).toBe(1550);
 });
 it('stops following once the loaded page has settled',()=>{
  vi.useFakeTimers({now:1000});
  scroll.y=1050;captureReadingPlace(window,'page-1',1000);scroll.y=0;
  restoreReadingPlace(window,'page-1',1000);expect(scroll.y).toBe(1050);
  vi.advanceTimersByTime(3000);
  layout.p2!.top+=200;grow?.();expect(scroll.y).toBe(1050);
 });
 it('falls back to the raw scroll when the anchor is gone, and ignores a stale record or another page\'s',()=>{
  scroll.y=1050;captureReadingPlace(window,'page-1',1000);scroll.y=0;delete layout.p2;document.querySelector('[data-af-id="p2"]')!.remove();
  restoreReadingPlace(window,'page-1',1000)();expect(scroll.y).toBe(1050);
  scroll.y=1050;captureReadingPlace(window,'page-1',1000);scroll.y=0;
  restoreReadingPlace(window,'page-2',1000);expect(scroll.y).toBe(0);
  restoreReadingPlace(window,'page-1',1000+60_000);expect(scroll.y).toBe(0);
  expect(sessionStorage.length).toBe(0);
 });
 it('degrades to a plain rebuild when storage is refused',()=>{
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('denied');});
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('denied');});
  scroll.y=1050;expect(()=>captureReadingPlace(window,'page-1')).not.toThrow();scroll.y=0;
  expect(()=>restoreReadingPlace(window,'page-1')).not.toThrow();expect(scroll.y).toBe(0);
 });
});
