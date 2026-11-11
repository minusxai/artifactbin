/**
 * A page where the browser blocks modal dialogs (the app's frame, the `/raw` sandbox) is told so once per dialog, with
 * what to use instead, and the call still answers what the browser answers there.
 */
import {runInNewContext} from 'node:vm';
import {expect,it} from 'vitest';
import {noticeBlockedModals} from '../modal-notice';
import {buildHtmlCore} from '../build.server';

const windowLike=(framed:boolean,origin='https://abc.pages.test')=>{
 const calls:string[]=[];
 const win:Record<string,unknown>={origin,alert:(text:string)=>{calls.push('alert:'+text);},confirm:()=>{calls.push('confirm');return false;},prompt:()=>{calls.push('prompt');return null;}};
 win.parent=framed?{}:win;
 return {win,calls};
};

it('warns the first time a framed or sandboxed page calls each blocked dialog, naming af-dialog, and keeps the browser answer',()=>{
 for(const [framed,origin] of [[true,'https://abc.pages.test'],[false,'null']] as const){
  const {win,calls}=windowLike(framed,origin);const warned:string[]=[];
  noticeBlockedModals(win as never,(message)=>warned.push(message));
  expect((win.confirm as ()=>boolean)()).toBe(false);
  expect((win.confirm as ()=>boolean)()).toBe(false);
  expect((win.prompt as ()=>string|null)()).toBeNull();
  (win.alert as (text:string)=>void)('hi');
  expect(calls).toEqual(['confirm','confirm','prompt','alert:hi']);
  expect(warned).toHaveLength(3);
  expect(warned[0]).toMatch(/confirm\(\) is blocked/);
  for(const message of warned)expect(message).toContain('af-dialog');
 }
});

it('leaves dialogs alone at a page\'s own unframed address, where the browser shows them',()=>{
 const {win}=windowLike(false);const alert=win.alert;
 noticeBlockedModals(win as never,()=>{throw Error('no warning expected');});
 expect(win.alert).toBe(alert);
});

it('is installed by the core before any author script runs',async()=>{
 const core=await buildHtmlCore();
 const {win,calls}=windowLike(true);const warned:string[]=[];
 const document={readyState:'complete',addEventListener(){},documentElement:{setAttribute(){},hasAttribute(){return false;}},querySelector:()=>null,createElement(){return {type:'',textContent:''};},currentScript:{src:'',after(){}}};
 runInNewContext(core,{document,location:{href:'https://abc.pages.test/',pathname:'/',search:''},window:win,URL,Blob,console:{warn:(message:string)=>warned.push(message)}});
 expect((win.confirm as ()=>boolean)()).toBe(false);
 expect(calls).toEqual(['confirm']);
 expect(warned.join('\n')).toMatch(/confirm\(\) is blocked[\s\S]*af-dialog/);
});
