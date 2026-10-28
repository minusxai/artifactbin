import {afterEach,describe,it,expect,vi} from 'vitest';
import {connectLocalDocument} from '../browser';
const identity={platformOrigin:'https://platform.example',artifactId:'page123',baseRevision:'1',sourceDigest:'a'.repeat(64)};
afterEach(()=>{document.querySelectorAll('iframe').forEach(frame=>frame.remove());vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('local file connection',()=>{
 it('never contacts the platform during private preview or remembered offline mode',()=>{
  for(const mode of [{privatePreview:true},{stayOffline:true}]){
   const states:string[]=[];const connection=connectLocalDocument({win:window,identity,...mode,onState:s=>states.push(s)});
   expect(document.querySelector('iframe')).toBeNull();expect(states).toEqual(['offline']);
   if('privatePreview' in mode){connection.retry();expect(document.querySelector('iframe')).toBeNull();}
   connection.dispose();
  }
 });
 it('rejects malformed destinations even on explicit retry',()=>{
  const connection=connectLocalDocument({win:window,identity:{...identity,platformOrigin:'javascript:alert(1)'},onState:()=>{}});
  connection.retry();expect(document.querySelector('iframe')).toBeNull();connection.dispose();
 });
 it('connects only to the saved platform and removes the broker on disconnect',()=>{
  const states:string[]=[];const connection=connectLocalDocument({win:window,identity,onState:s=>states.push(s)});
  const frame=document.querySelector('iframe')!;expect(frame.style.colorScheme).toBe('light');expect(new URL(frame.src).origin).toBe(identity.platformOrigin);expect(frame.src).toContain('/local/connect#nonce=');
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
it('uses secure random bytes when randomUUID is absent and fails clearly if WebCrypto is missing',()=>{
 const crypto=window.crypto;vi.stubGlobal('crypto',{getRandomValues:crypto.getRandomValues.bind(crypto)});
 const connection=connectLocalDocument({win:window,identity,onState:()=>{}});const frame=document.querySelector('iframe')!;expect(new URLSearchParams(new URL(frame.src).hash.slice(1)).get('nonce')).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);connection.dispose();
 vi.stubGlobal('crypto',undefined);const states:string[]=[];expect(()=>connectLocalDocument({win:window,identity,onState:s=>states.push(s)})).toThrow(/Web ?Crypto|getRandomValues/);expect(states).toEqual(['blocked']);expect(document.querySelector('iframe')).toBeNull();vi.unstubAllGlobals();
});

it('does not contact an HTTP DNS alias preserved as portable provenance',()=>{
 const states:string[]=[];const connection=connectLocalDocument({win:window,identity:{...identity,platformOrigin:'http://app.lvh.me:53324'},onState:value=>states.push(value)});
 expect(document.querySelector('iframe')).toBeNull();expect(states).toContain('unavailable');connection.retry();expect(document.querySelector('iframe')).toBeNull();connection.dispose();
});
it('does not expire the initial handshake timer after a connected idle period',async()=>{
 vi.useFakeTimers();const port={onmessage:null as ((event:MessageEvent)=>void)|null,onmessageerror:null,start:vi.fn(),close:vi.fn(),postMessage:vi.fn()};vi.stubGlobal('MessageChannel',class{port1=port;port2={};});const states:string[]=[];const connection=connectLocalDocument({win:window,identity,timeoutMs:10,onState:state=>states.push(state)});
 try{const frame=document.querySelector('iframe')!;vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation(()=>{});const nonce=new URLSearchParams(new URL(frame.src).hash.slice(1)).get('nonce');window.dispatchEvent(new MessageEvent('message',{origin:identity.platformOrigin,source:frame.contentWindow,data:{kind:'af:local-ready',nonce}}));port.onmessage?.({data:{kind:'state',state:'connected',role:'viewer'}} as MessageEvent);await vi.advanceTimersByTimeAsync(300_000);expect(states.at(-1)).toBe('connected');expect(frame.isConnected).toBe(true);expect(port.close).not.toHaveBeenCalled();}
 finally{connection.dispose();vi.useRealTimers();}
});
it('expands against the parent viewport, follows its resize and collapses without stale resize authority',()=>{
 const port={onmessage:null as ((event:MessageEvent)=>void)|null,onmessageerror:null,start:vi.fn(),close:vi.fn(),postMessage:vi.fn()};vi.stubGlobal('MessageChannel',class{port1=port;port2={};});vi.stubGlobal('innerHeight',720);
 const removed=vi.spyOn(window,'removeEventListener');const connection=connectLocalDocument({win:window,identity,onState:()=>{}});
 try{const frame=document.querySelector('iframe')!;expect(frame.style.height).toBe('76px');vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation(()=>{});const nonce=new URLSearchParams(new URL(frame.src).hash.slice(1)).get('nonce');window.dispatchEvent(new MessageEvent('message',{origin:identity.platformOrigin,source:frame.contentWindow,data:{kind:'af:local-ready',nonce}}));
  const send=(height:unknown)=>port.onmessage?.({data:height==='viewport'?{kind:'chrome-size',mode:'viewport'}:{kind:'chrome-size',height}} as MessageEvent);
  send(76);expect(frame.style.height).toBe('76px');send('viewport');expect(frame.style.height).toBe('720px');vi.stubGlobal('innerHeight',480);window.dispatchEvent(new Event('resize'));expect(frame.style.height).toBe('480px');send('invalid');expect(frame.style.height).toBe('480px');send(76);window.dispatchEvent(new Event('resize'));expect(frame.style.height).toBe('76px');connection.disconnect();send('viewport');expect(frame.isConnected).toBe(false);connection.dispose();expect(removed).toHaveBeenCalledWith('resize',expect.any(Function));
 }finally{connection.dispose();}
});

it('replays only validated advisory source evidence on a fresh channel and stops after disposal',()=>{
 const ports:Array<{onmessage:unknown;onmessageerror:unknown;start:ReturnType<typeof vi.fn>;close:ReturnType<typeof vi.fn>;postMessage:ReturnType<typeof vi.fn>}>=[];
 vi.stubGlobal('MessageChannel',class {port1={onmessage:null,onmessageerror:null,start:vi.fn(),close:vi.fn(),postMessage:vi.fn()};port2={};constructor(){ports.push(this.port1);}});
 const connection=connectLocalDocument({win:window,identity,onState:()=>{}});
 const bind=()=>{const frame=document.querySelector('iframe')!;vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation(()=>{});const nonce=new URLSearchParams(new URL(frame.src).hash.slice(1)).get('nonce');window.dispatchEvent(new MessageEvent('message',{origin:identity.platformOrigin,source:frame.contentWindow,data:{kind:'af:local-ready',nonce}}));};
 connection.reportSource('bad');bind();expect(ports[0]!.postMessage).not.toHaveBeenCalled();
 const message={kind:'local-source-evidence',localDigest:'b'.repeat(64)};connection.reportSource(message.localDigest);expect(ports[0]!.postMessage).toHaveBeenCalledWith(message);
 connection.retry();bind();expect(ports[1]!.postMessage).toHaveBeenCalledWith(message);
 connection.dispose();const count=ports[1]!.postMessage.mock.calls.length;connection.reportSource('c'.repeat(64));expect(ports[1]!.postMessage).toHaveBeenCalledTimes(count);
});
