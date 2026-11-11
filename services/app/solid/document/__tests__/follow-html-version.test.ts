import {afterEach,describe,expect,it,vi} from 'vitest';
import {followHtmlVersion} from '@/lib/html-reader/follow-version';
import {followPublication} from '../follow-html-version';
import {HTML_VERSION_APPLIED,HTML_VERSION_MESSAGE,HTML_VERSION_REBUILT,HTML_VERSION_REFUSED} from '@/lib/html-reader/contract';

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
  expect(controller.sent).toEqual([{type:HTML_VERSION_MESSAGE,version:7,live:0}]);expect(refresh).toHaveBeenCalledWith(7,'7');expect(reload).not.toHaveBeenCalled();
 });
 it('follows a frame that rebuilds its own document (scripts changed, edit not inert): the trusted revision moves, the page does not reload',async()=>{
  const reload=vi.fn(),refresh=vi.fn(async()=>true),controller=frame(command=>({type:HTML_VERSION_REBUILT,revision:String(command.version)}));
  await expect(followHtmlVersion({version:7,frame:controller,refresh,reload})).resolves.toBe('rebuilt');
  expect(refresh).toHaveBeenCalledWith(7,'7');expect(reload).not.toHaveBeenCalled();
 });
 it('reloads when the frame refuses (it could read no valid new version)',async()=>{
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
   send:vi.fn((command:{version:number})=>{answers.push(()=>listeners.forEach(listener=>listener({type:command.version===5?HTML_VERSION_REBUILT:HTML_VERSION_APPLIED,revision:String(command.version)})));})};
  const five=followPublication({version:5,editId:'five',frame:controller,show,reload});
  await vi.waitFor(()=>expect(answers).toHaveLength(1));
  // Announced while 5 is being drawn (rebuilt, which keeps following): 6 is overtaken by 7 before its turn.
  const six=followPublication({version:6,editId:'six',frame:controller,show,reload});
  const seven=followPublication({version:7,editId:'seven',frame:controller,show,reload});
  answers[0]!();await five;
  await vi.waitFor(()=>expect(answers).toHaveLength(2));answers[1]!();await Promise.all([six,seven]);
  expect(controller.send.mock.calls.map(call=>call[0].version)).toEqual([5,7]);
  expect(show.mock.calls).toEqual([[{version:5,editId:'five'}],[{version:7,editId:'seven'}]]);expect(reload).not.toHaveBeenCalled();
 });
 it('follows live text within a version in (version, live) order, skipping live text overtaken while it waited',async()=>{
  const show=vi.fn(),reload=vi.fn(),answers:Array<()=>void>=[];
  const listeners=new Set<(event:unknown)=>void>();
  const controller={subscribe:(listener:(event:unknown)=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
   send:vi.fn((command:{version:number;live:number})=>{answers.push(()=>listeners.forEach(listener=>listener({type:HTML_VERSION_APPLIED,revision:String(command.version)})));})};
  const first=followPublication({version:9,live:4,editId:'nine',frame:controller,show,reload});
  await vi.waitFor(()=>expect(answers).toHaveLength(1));
  const older=followPublication({version:9,live:3,editId:'nine',frame:controller,show,reload});
  const middle=followPublication({version:9,live:6,editId:'nine',frame:controller,show,reload});
  const last=followPublication({version:9,live:8,editId:'nine',frame:controller,show,reload});
  answers[0]!();await first;
  await vi.waitFor(()=>expect(answers).toHaveLength(2));answers[1]!();await Promise.all([older,middle,last]);
  expect(controller.send.mock.calls.map(call=>[call[0].version,call[0].live])).toEqual([[9,4],[9,8]]);
  expect(reload).not.toHaveBeenCalled();
 });
 it('never reloads for live text the frame could not draw within the version it shows; a new version still reloads',async()=>{
  const reload=vi.fn(),show=vi.fn();
  const refusing=frame(()=>({type:HTML_VERSION_REFUSED,reason:'the new version answered 404'}));
  await followPublication({version:20,live:3,drawn:20,editId:'e',frame:refusing,show,reload});
  await followPublication({version:20,live:5,drawn:20,editId:'e',frame:refusing,show,reload});
  expect(reload).not.toHaveBeenCalled();
  expect(refusing.sent).toHaveLength(2);
  void followPublication({version:21,live:0,drawn:20,editId:'f',frame:refusing,show,reload});
  await vi.waitFor(()=>expect(reload).toHaveBeenCalledOnce());
 });
});
