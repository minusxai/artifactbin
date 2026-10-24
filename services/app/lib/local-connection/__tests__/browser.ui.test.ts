import {afterEach,describe,it,expect,vi} from 'vitest';
import {connectLocalDocument} from '../browser';
const identity={platformOrigin:'https://platform.example',artifactId:'page123',baseRevision:'1',sourceDigest:'a'.repeat(64)};
afterEach(()=>{document.querySelectorAll('iframe').forEach(frame=>frame.remove());vi.restoreAllMocks();});
describe('local file connection',()=>{
 it('never contacts the platform during private preview or remembered offline mode',()=>{
  for(const mode of [{privatePreview:true},{stayOffline:true}]){
   const states:string[]=[];const connection=connectLocalDocument({win:window,identity,...mode,onState:s=>states.push(s)});
   expect(document.querySelector('iframe')).toBeNull();expect(states).toEqual(['offline']);
   if('privatePreview' in mode){connection.retry();connection.signIn();expect(document.querySelector('iframe')).toBeNull();}
   connection.dispose();
  }
 });
 it('rejects malformed destinations even on explicit retry',()=>{
  const connection=connectLocalDocument({win:window,identity:{...identity,platformOrigin:'javascript:alert(1)'},onState:()=>{}});
  connection.retry();expect(document.querySelector('iframe')).toBeNull();connection.dispose();
 });
 it('connects only to the saved platform and removes the broker on disconnect',()=>{
  const states:string[]=[];const connection=connectLocalDocument({win:window,identity,onState:s=>states.push(s)});
  const frame=document.querySelector('iframe')!;expect(new URL(frame.src).origin).toBe(identity.platformOrigin);expect(frame.src).toContain('/local/connect#nonce=');
  expect(states).toEqual(['connecting']);connection.disconnect();expect(document.querySelector('iframe')).toBeNull();expect(states.at(-1)).toBe('offline');connection.dispose();
 });
});
it('ends authority after an uncertain operation deadline and never sends a second operation',async()=>{
 vi.useFakeTimers();
 const port={onmessage:null as ((event:MessageEvent)=>void)|null,onmessageerror:null,start:vi.fn(),close:vi.fn(),postMessage:vi.fn()};
 vi.stubGlobal('MessageChannel',class {port1=port;port2={};});
 const states:string[]=[];const connection=connectLocalDocument({win:window,identity,timeoutMs:10,onState:s=>states.push(s)});
 try{
  const frame=document.querySelector('iframe')!;vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation(()=>{});
  const nonce=new URLSearchParams(new URL(frame.src).hash.slice(1)).get('nonce');
  window.dispatchEvent(new MessageEvent('message',{origin:identity.platformOrigin,source:frame.contentWindow,data:{kind:'af:local-ready',nonce}}));
  port.onmessage?.({data:{kind:'state',state:'connected',role:'viewer'}} as MessageEvent);
  const operation=connection.request({query:'mutation { tasks { add } }',operation:'mutation'});const outcome=expect(operation).rejects.toThrow('outcome is unknown');
  await vi.advanceTimersByTimeAsync(11);await outcome;
  expect(states.at(-1)).toBe('unknown-outcome');expect(document.querySelector('iframe')).toBeNull();
  await expect(connection.request({query:'{ tasks { count } }'})).rejects.toThrow('disconnected');
  expect(port.postMessage.mock.calls.filter(call=>call[0].kind==='operation')).toHaveLength(1);
 }finally{connection.dispose();vi.useRealTimers();vi.unstubAllGlobals();}
});
it('ignores queued authority and observation messages after explicit disconnect',()=>{
 const port={onmessage:null as ((event:MessageEvent)=>void)|null,onmessageerror:null,start:vi.fn(),close:vi.fn(),postMessage:vi.fn()};vi.stubGlobal('MessageChannel',class {port1=port;port2={};});
 const states:string[]=[],observed=vi.fn();const connection=connectLocalDocument({win:window,identity,onState:s=>states.push(s),onSourceObservation:observed});
 try{
  const frame=document.querySelector('iframe')!;vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation(()=>{});const nonce=new URLSearchParams(new URL(frame.src).hash.slice(1)).get('nonce');
  window.dispatchEvent(new MessageEvent('message',{origin:identity.platformOrigin,source:frame.contentWindow,data:{kind:'af:local-ready',nonce}}));
  connection.disconnect();port.onmessage?.({data:{kind:'state',state:'connected',role:'owner'}} as MessageEvent);port.onmessage?.({data:{kind:'source-observation',remoteDigest:'b'.repeat(64),remoteRevision:'2'}} as MessageEvent);
  expect(states.at(-1)).toBe('offline');expect(observed).not.toHaveBeenCalled();
 }finally{connection.dispose();vi.unstubAllGlobals();}
});
