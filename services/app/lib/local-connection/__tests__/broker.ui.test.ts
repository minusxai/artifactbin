import {it,expect,vi,afterEach} from 'vitest';
import {installLocalConnectionBroker} from '../broker';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();history.replaceState(null,'','/');});
const fakePort=()=>({postMessage:vi.fn(),start:vi.fn(),close:vi.fn(),onmessage:null} as unknown as MessagePort);
const identity=()=>({platformOrigin:location.origin,artifactId:'page123',baseRevision:'1',sourceDigest:'a'.repeat(64)});
it('rejects unknown windows, origins and nonces before requesting authority',async()=>{
 history.replaceState(null,'','/#nonce=test-nonce');const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const broker=installLocalConnectionBroker({win:window,onState:()=>{}});
 const send=(source:Window,origin:string,nonce:string)=>window.dispatchEvent(new MessageEvent('message',{origin,source,data:{kind:'af:local-bind',nonce,identity:identity()},ports:[fakePort()]}));
 send({} as Window,'null','test-nonce');send(window,'https://untrusted.example','test-nonce');send(window,'null','different-nonce');
 await Promise.resolve();expect(fetch).not.toHaveBeenCalled();broker.dispose();
});



it('does not replay duplicate calls and revokes an unavailable connection',async()=>{
 history.replaceState(null,'','/#nonce=test-nonce');
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({capability:'secret',role:'viewer',readOnly:true})}).mockResolvedValueOnce({ok:true,text:async()=>'{"data":{"saved":true}}'}).mockResolvedValueOnce({ok:false,status:404,text:async()=>'{"error":"unavailable"}'}).mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetch);
 const states:string[]=[];const broker=installLocalConnectionBroker({win:window,onState:s=>states.push(s)}),port=fakePort();
 window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity:identity()},ports:[port]}));await vi.waitFor(()=>expect(states.at(-1)).toBe('connected'));
 const operation={kind:'operation',call:1,operation:{query:'{ tasks { count } }',operation:'query'}};
 await port.onmessage?.({data:operation} as MessageEvent);await port.onmessage?.({data:operation} as MessageEvent);expect(fetch).toHaveBeenCalledTimes(2);
 await port.onmessage?.({data:{...operation,call:2}} as MessageEvent);expect(states.at(-1)).toBe('unavailable');
 await port.onmessage?.({data:{...operation,call:3}} as MessageEvent);expect(fetch).toHaveBeenCalledTimes(4);broker.dispose();
});
it('reports readable remote evidence for a stale base without connecting or sending authority',async()=>{
 history.replaceState(null,'','/#nonce=test-nonce');
 const observation={remoteDigest:'b'.repeat(64),remoteRevision:'2'};
 const fetch=vi.fn().mockResolvedValueOnce({ok:false,status:409,json:async()=>({error:'stale'})}).mockResolvedValueOnce({ok:true,json:async()=>observation});vi.stubGlobal('fetch',fetch);
 const evidence=vi.fn(),states:string[]=[];const broker=installLocalConnectionBroker({win:window,onState:s=>states.push(s),onSourceObservation:evidence}),port=fakePort();
 window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity:identity()},ports:[port]}));
 await vi.waitFor(()=>expect(states.at(-1)).toBe('stale'));expect(evidence).toHaveBeenCalledExactlyOnceWith(observation);
 expect(port.postMessage).toHaveBeenCalledWith({kind:'source-observation',...observation});expect(states).not.toContain('connected');expect(fetch.mock.calls[1]![1]).toMatchObject({credentials:'omit'});broker.dispose();
});
it('observes an idle remote head change and clears authority without changing the local source',async()=>{
 vi.useFakeTimers();history.replaceState(null,'','/#nonce=test-nonce');
 const changed={compatible:false,role:'viewer',readOnly:true,remoteDigest:'b'.repeat(64),remoteRevision:'2'};
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({capability:'guest-secret',role:'viewer',readOnly:true})}).mockResolvedValueOnce({ok:true,json:async()=>changed}).mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetch);
 const states:string[]=[];const broker=installLocalConnectionBroker({win:window,onState:s=>states.push(s)}),port=fakePort();
 try{
  window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity:identity()},ports:[port]}));await vi.advanceTimersByTimeAsync(0);expect(states.at(-1)).toBe('connected');
  await vi.advanceTimersByTimeAsync(15_000);expect(states.at(-1)).toBe('stale');
  expect(port.postMessage).toHaveBeenCalledWith({kind:'source-observation',remoteDigest:changed.remoteDigest,remoteRevision:'2'});
  const calls=fetch.mock.calls.length;await port.onmessage?.({data:{kind:'operation',call:1,operation:{query:'mutation { tasks { add } }'}}} as MessageEvent);expect(fetch).toHaveBeenCalledTimes(calls);
 }finally{broker.dispose();vi.useRealTimers();}
});


it('revokes an idle status timeout but retains trusted recovery and retries only as a guest',async()=>{
 vi.useFakeTimers();history.replaceState(null,'','/#nonce=test-nonce');const fetch=vi.fn().mockImplementation(async(url)=>String(url).endsWith('/status')?new Promise(()=>{}):{ok:true,json:async()=>({capability:'guest-secret',role:'viewer',readOnly:true,authenticated:false})});vi.stubGlobal('fetch',fetch);const states:string[]=[];const broker=installLocalConnectionBroker({win:window,onState:state=>states.push(state)}),port=fakePort();
 try{window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity:identity()},ports:[port]}));await vi.advanceTimersByTimeAsync(0);expect(states.at(-1)).toBe('connected');await vi.advanceTimersByTimeAsync(25_000);expect(states.at(-1)).toBe('blocked');expect(port.close).not.toHaveBeenCalled();const count=fetch.mock.calls.length;await vi.advanceTimersByTimeAsync(30_000);expect(fetch).toHaveBeenCalledTimes(count);broker.retry();await vi.advanceTimersByTimeAsync(0);expect(states.at(-1)).toBe('connected');const grants=fetch.mock.calls.filter(call=>call[1]?.method==='POST');expect(grants).toHaveLength(2);for(const grant of grants){expect(grant[1]).toMatchObject({credentials:'omit'});expect(JSON.parse(grant[1].body)).toEqual({identity:identity()});}}
 finally{broker.dispose();vi.useRealTimers();}
});

it('keeps reads anonymous, rejects legacy account grants and ignores upgrade messages',async()=>{
 history.replaceState(null,'','/#nonce=test-nonce');const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({capability:'guest-secret',role:'viewer',readOnly:true,authenticated:false})});vi.stubGlobal('fetch',fetch);const open=vi.spyOn(window,'open').mockImplementation(()=>null);const connected=vi.fn();const broker=installLocalConnectionBroker({win:window,onState:()=>{},onConnected:connected}),port=fakePort();
 try{window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity:identity()},ports:[port]}));await vi.waitFor(()=>expect(connected).toHaveBeenCalledOnce());expect(connected.mock.calls[0]![0]).toMatchObject({readOnly:true,role:'viewer'});for(const kind of ['authorize','signin','af:local-authenticated'])await port.onmessage?.({data:{kind}} as MessageEvent);expect(fetch).toHaveBeenCalledOnce();expect(fetch.mock.calls[0]![1]).toMatchObject({credentials:'omit'});expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({identity:identity()});expect(open).not.toHaveBeenCalled();expect('authorize' in broker).toBe(false);expect('signIn' in broker).toBe(false);}
 finally{broker.dispose();}
});
it('refuses an old account-backed grant instead of announcing a read-only connection',async()=>{
 history.replaceState(null,'','/#nonce=test-nonce');vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({capability:'legacy',role:'owner',authenticated:true})}));const states:string[]=[];const broker=installLocalConnectionBroker({win:window,onState:state=>states.push(state)}),port=fakePort();try{window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity:identity()},ports:[port]}));await vi.waitFor(()=>expect(states.at(-1)).toBe('blocked'));expect(states).not.toContain('connected');}finally{broker.dispose();}
});
it('clears read authority on an observed publication without replacing the local document',async()=>{
 history.replaceState(null,'','/#nonce=test-nonce');const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({capability:'guest-secret',role:'viewer',readOnly:true})});vi.stubGlobal('fetch',fetch);const states:string[]=[];const broker=installLocalConnectionBroker({win:window,onState:state=>states.push(state)}),port=fakePort();try{window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity:identity()},ports:[port]}));await vi.waitFor(()=>expect(states.at(-1)).toBe('connected'));broker.sourceChanged();expect(states.at(-1)).toBe('stale');const calls=fetch.mock.calls.length;await port.onmessage?.({data:{kind:'operation',call:1,operation:{query:'{ counter { count } }'}}} as MessageEvent);expect(fetch).toHaveBeenCalledTimes(calls);expect(port.postMessage).toHaveBeenCalledWith({kind:'state',state:'stale'});}finally{broker.dispose();}
});
