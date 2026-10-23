import {afterEach,expect,it,vi} from 'vitest';
import {startHtmlPresence} from '../../html-bridge/presence';
import {readerDefaults,type PresenceGeometry} from '../../html-presence/contract';
afterEach(()=>{document.body.innerHTML='';window.getSelection()?.removeAllRanges();vi.restoreAllMocks();});
it('shares offsets without text, excludes private inputs and duplicate identities, and paints without changing native selection',()=>{
 document.body.innerHTML='<p data-af-id="a">Public text</p><input data-af-id="secret" value="private"><p data-af-id="duplicate">One</p><p data-af-id="duplicate">Two</p>';
 const p=document.querySelector('p')!;vi.spyOn(p,'getBoundingClientRect').mockReturnValue({x:0,y:0,width:200,height:100,left:0,top:0,right:200,bottom:100,toJSON(){}});
 const sent:PresenceGeometry[]=[],presence=startHtmlPresence(window,value=>sent.push(value));
 p.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:50,clientY:25}));expect(sent.at(-1)?.cursor).toEqual({nodeId:'a',x:.25,y:.25});
 const range=document.createRange();range.setStart(p.firstChild!,0);range.setEnd(p.firstChild!,6);window.getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));
 expect(sent.at(-1)?.selection?.[0]).toMatchObject({nodeId:'a',start:0,end:6,length:11});expect(JSON.stringify(sent)).not.toContain('Public');
 presence.receive({preferences:readerDefaults,viewers:[{id:'other',label:'Other viewer',revision:'1',seen:1,cursor:{nodeId:'a',x:.5,y:.5},selection:null}]});expect(document.querySelector('[data-af-presence-cursor]')?.textContent).toContain('Other viewer');expect(window.getSelection()!.toString()).toBe('Public');
 presence.receive({preferences:{...readerDefaults,showCursors:false},viewers:[{id:'other',label:'Other viewer',revision:'1',seen:1,cursor:{nodeId:'a',x:.5,y:.5},selection:null}]});expect(document.querySelector('[data-af-presence-cursor]')).toBeNull();
 document.querySelector('input')!.dispatchEvent(new MouseEvent('pointermove',{bubbles:true}));expect(sent.at(-1)?.cursor).toBeNull();
 document.querySelectorAll('p')[1]!.dispatchEvent(new MouseEvent('pointermove',{bubbles:true}));expect(sent.at(-1)?.cursor).toBeNull();
 presence.dispose();expect(document.querySelector('[data-af="presence-overlay"]')).toBeNull();
});
