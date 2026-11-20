import {afterEach,expect,it,vi} from 'vitest';
import {startHtmlPresence} from '../presence';
import {readerDefaults,type PresenceGeometry} from '../../html-presence/contract';
import {htmlTextFingerprint} from '@artifactbin/contracts/html-annotation';
afterEach(()=>{document.body.innerHTML='';window.getSelection()?.removeAllRanges();vi.restoreAllMocks();});
it('draws one person once: one cursor for all their sessions, and one name label for a cursor with a selection',()=>{
 document.body.innerHTML='<p data-af-id="a">Public text</p>';
 vi.spyOn(document.querySelector('p')!,'getBoundingClientRect').mockReturnValue({x:0,y:0,width:200,height:100,left:0,top:0,right:200,bottom:100,toJSON(){}});
 const root=document.documentElement,rects=Range.prototype.getClientRects;
 Object.defineProperty(root,'clientWidth',{configurable:true,value:1200});Object.defineProperty(root,'clientHeight',{configurable:true,value:900});
 Range.prototype.getClientRects=function(){return [{x:10,y:40,width:60,height:20}] as unknown as DOMRectList;};
 const presence=startHtmlPresence(window,()=>{});
 try{
  const person='c'.repeat(64),viewer=(id:string,seen:number,x:number,selection:boolean)=>({id,colorId:person,label:'Reader name',revision:'1',seen,cursor:{nodeId:'a',x,y:.5},selection:selection?[{nodeId:'a',start:0,end:6,length:11,fingerprint:htmlTextFingerprint('Public text')}]:null});
  presence.receive({preferences:readerDefaults,viewers:[viewer('earlier',1,.2,false),viewer('live',2,.25,false)]});
  const marks=[...document.querySelectorAll<HTMLElement>('[data-af-presence-cursor]')];
  expect(marks).toHaveLength(1);expect(marks[0]!.style.left).toBe('50px');
  presence.receive({preferences:readerDefaults,viewers:[viewer('live',3,.25,true)]});
  expect(document.querySelectorAll('[data-af-presence-selection]').length).toBeGreaterThan(0);
  const names=[...document.querySelectorAll('[data-af="presence-overlay"] div')].filter(node=>node.children.length===0&&node.textContent?.includes('Reader name'));
  expect(names).toHaveLength(1);
  // Without a drawn cursor, the selection carries the name.
  presence.receive({preferences:{...readerDefaults,showCursors:false},viewers:[viewer('live',4,.25,true)]});
  expect([...document.querySelectorAll('[data-af="presence-overlay"] div')].filter(node=>node.children.length===0&&node.textContent?.includes('Reader name'))).toHaveLength(1);
 }finally{presence.dispose();Range.prototype.getClientRects=rects;delete (root as unknown as Record<string,unknown>).clientWidth;delete (root as unknown as Record<string,unknown>).clientHeight;}
});
it('shares offsets without text, excludes private inputs and duplicate identities, and paints without changing native selection',()=>{
 document.body.innerHTML='<p data-af-id="a">Public text</p><div data-af-id="form"><input value="private"></div><p data-af-id="mixed">Public<span data-af-private>Private</span></p><p data-af-id="duplicate">One</p><p data-af-id="duplicate">Two</p>';
 const p=document.querySelector('p')!;vi.spyOn(p,'getBoundingClientRect').mockReturnValue({x:0,y:0,width:200,height:100,left:0,top:0,right:200,bottom:100,toJSON(){}});
 vi.spyOn(document.querySelector('[data-af-id="form"]')!,'getBoundingClientRect').mockReturnValue(p.getBoundingClientRect());
 const sent:PresenceGeometry[]=[],presence=startHtmlPresence(window,value=>sent.push(value));
 p.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:50,clientY:25}));expect(sent.at(-1)?.cursor).toEqual({nodeId:'a',x:.25,y:.25});
 const range=document.createRange();range.setStart(p.firstChild!,0);range.setEnd(p.firstChild!,6);window.getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));
 expect(sent.at(-1)?.selection?.[0]).toMatchObject({nodeId:'a',start:0,end:6,length:11});expect(JSON.stringify(sent)).not.toContain('Public');
 presence.receive({preferences:readerDefaults,viewers:[{id:'other',label:'Other viewer',revision:'1',seen:1,cursor:{nodeId:'a',x:.5,y:.5},selection:null}]});expect(document.querySelector('[data-af-presence-cursor]')?.textContent).toContain('Other viewer');expect(window.getSelection()!.toString()).toBe('Public');
 presence.receive({preferences:{...readerDefaults,showCursors:false},viewers:[{id:'other',label:'Other viewer',revision:'1',seen:1,cursor:{nodeId:'a',x:.5,y:.5},selection:null}]});expect(document.querySelector('[data-af-presence-cursor]')).toBeNull();
 document.querySelector('input')!.dispatchEvent(new MouseEvent('pointermove',{bubbles:true}));expect(sent.at(-1)?.cursor).toBeNull();
 document.querySelector('[data-af-id="duplicate"]')!.dispatchEvent(new MouseEvent('pointermove',{bubbles:true}));expect(sent.at(-1)?.cursor).toBeNull();
 const privateRange=document.createRange();privateRange.selectNodeContents(document.querySelector('[data-af-id="mixed"]')!);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(privateRange);document.dispatchEvent(new Event('selectionchange'));expect(sent.at(-1)?.selection).toBeNull();
 presence.dispose();expect(document.querySelector('[data-af="presence-overlay"]')).toBeNull();
});
it('glides a moved cursor across one publication window and repaints a scrolled one without lag',()=>{
 document.body.innerHTML='<p data-af-id="a">Public text</p>';
 vi.spyOn(document.querySelector('p')!,'getBoundingClientRect').mockReturnValue({x:0,y:0,width:200,height:100,left:0,top:0,right:200,bottom:100,toJSON(){}});
 const presence=startHtmlPresence(window,()=>{});
 const viewer=(x:number)=>({id:'other',label:'Other viewer',revision:'1',seen:1,cursor:{nodeId:'a',x,y:.5},selection:null});
 presence.receive({preferences:readerDefaults,viewers:[viewer(.25)]});
 const mark=document.querySelector<HTMLElement>('[data-af-presence-cursor]')!;expect(mark.style.left).toBe('50px');expect(mark.style.transition).toBe('none');
 presence.receive({preferences:readerDefaults,viewers:[viewer(.75)]});
 expect(document.querySelector('[data-af-presence-cursor]')).toBe(mark);expect(mark.style.left).toBe('150px');expect(mark.style.transition).toContain('250ms');
 presence.paint();expect(mark.style.transition).toBe('none');
 presence.receive({preferences:readerDefaults,viewers:[]});expect(document.querySelector('[data-af-presence-cursor]')).toBeNull();
 presence.dispose();
});
