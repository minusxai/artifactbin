import {afterEach,describe,expect,it,vi} from 'vitest';
import {followHtmlVersion,followPublication} from '../follow-html-version';
import {HTML_VERSION_APPLIED,HTML_VERSION_MESSAGE,HTML_VERSION_REFUSED} from '@/lib/html-runtime/live-morph-contract';

/** A frame controller that answers the version command with `answer` (or stays silent). */
function frame(answer?:(command:{type:string;version:number})=>unknown){
 const listeners=new Set<(event:unknown)=>void>(),sent:unknown[]=[];
 return {sent,send(command:unknown){sent.push(command);const reply=answer?.(command as {type:string;version:number});if(reply)queueMicrotask(()=>{for(const listener of [...listeners])listener(reply);});},subscribe(listener:(event:unknown)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}};
}
afterEach(()=>vi.useRealTimers());

describe('followHtmlVersion',()=>{
 it('morphs: the frame draws the version, the page refreshes its trusted revision and does not reload',async()=>{
  const reload=vi.fn(),refresh=vi.fn(async()=>true),controller=frame(command=>({type:HTML_VERSION_APPLIED,revision:String(command.version)}));
  await expect(followHtmlVersion({version:7,frame:controller,refresh,reload})).resolves.toBe('morphed');
  expect(controller.sent).toEqual([{type:HTML_VERSION_MESSAGE,version:7}]);expect(refresh).toHaveBeenCalledWith(7,'7');expect(reload).not.toHaveBeenCalled();
 });
 it('reloads when the frame refuses (scripts changed, edit not inert, morph threw)',async()=>{
  const reload=vi.fn();
  await expect(followHtmlVersion({version:7,frame:frame(()=>({type:HTML_VERSION_REFUSED,reason:'the new version runs different scripts'})),refresh:async()=>true,reload})).resolves.toBe('reloaded');
  expect(reload).toHaveBeenCalledOnce();
 });
 it('reloads on a mismatched or failed refresh',async()=>{
  for(const refresh of [async()=>false,async()=>{throw Error('offline');}]){
   const reload=vi.fn();
   await expect(followHtmlVersion({version:7,frame:frame(()=>({type:HTML_VERSION_APPLIED,revision:'6'})),refresh,reload})).resolves.toBe('reloaded');
   expect(reload).toHaveBeenCalledOnce();
  }
 });
 it('reloads when the frame stays silent past the timeout, or there is no frame',async()=>{
  vi.useFakeTimers();const reload=vi.fn();
  const pending=followHtmlVersion({version:7,frame:frame(),refresh:async()=>true,reload,timeoutMs:3000});
  await vi.advanceTimersByTimeAsync(2999);expect(reload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);await expect(pending).resolves.toBe('reloaded');expect(reload).toHaveBeenCalledOnce();
  const none=vi.fn();await expect(followHtmlVersion({version:8,frame:null,refresh:async()=>true,reload:none})).resolves.toBe('reloaded');expect(none).toHaveBeenCalledOnce();
 });
});

describe('followPublication',()=>{
 it('follows one version at a time, skips versions overtaken while they waited, and moves the trusted head with each drawn version',async()=>{
  const show=vi.fn(),reload=vi.fn(),answers:Array<()=>void>=[];
  const listeners=new Set<(event:unknown)=>void>();
  const controller={update:vi.fn(),subscribe:(listener:(event:unknown)=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
   send:vi.fn((command:{version:number})=>{answers.push(()=>listeners.forEach(listener=>listener({type:HTML_VERSION_APPLIED,revision:String(command.version)})));})};
  const tree=vi.fn(async()=>undefined);
  const five=followPublication({version:5,editId:'five',frame:controller,tree,show,reload});
  await vi.waitFor(()=>expect(answers).toHaveLength(1));
  // Announced while 5 is being drawn: 6 is overtaken by 7 before its turn.
  const six=followPublication({version:6,editId:'six',frame:controller,tree,show,reload});
  const seven=followPublication({version:7,editId:'seven',frame:controller,tree,show,reload});
  answers[0]!();await five;
  await vi.waitFor(()=>expect(answers).toHaveLength(2));answers[1]!();await Promise.all([six,seven]);
  expect(controller.send.mock.calls.map(call=>call[0].version)).toEqual([5,7]);
  expect(show.mock.calls).toEqual([[{version:5,editId:'five'}],[{version:7,editId:'seven'}]]);expect(reload).not.toHaveBeenCalled();
 });
});
