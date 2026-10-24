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
it('keeps capability secrets on the platform and exposes account consent only to platform UI',async()=>{
 history.replaceState(null,'','/#nonce=test-nonce');const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({capability:'platform-only-secret',role:'viewer'})});vi.stubGlobal('fetch',fetch);
 const broker=installLocalConnectionBroker({win:window,onState:()=>{}}),port=fakePort();
 window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity:identity()},ports:[port]}));
 await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));await Promise.resolve();
 expect(fetch.mock.calls[0]![1]).toMatchObject({credentials:'omit'});expect(fetch.mock.calls[0]![1].body).toContain('"authorizePrivate":false');
 expect(JSON.stringify(vi.mocked(port.postMessage).mock.calls)).not.toContain('platform-only-secret');
 await port.onmessage?.({data:{kind:'authorize'}} as MessageEvent);expect(fetch).toHaveBeenCalledTimes(1);
 broker.authorize();await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(3));expect(fetch.mock.calls[2]![1]).toMatchObject({credentials:'same-origin'});expect(fetch.mock.calls[2]![1].body).toContain('"authorizePrivate":true');
 broker.dispose();
});
it('retains its local channel while normal login returns directly to the platform and still requires consent',async()=>{
 history.replaceState(null,'','/#nonce=test-nonce');
 const response=(status:number,value:unknown)=>({ok:status===200,status,json:async()=>value});
 const fetch=vi.fn().mockResolvedValueOnce(response(401,{})).mockResolvedValueOnce(response(401,{})).mockResolvedValueOnce(response(403,{})).mockResolvedValue(response(200,{capability:'account-secret',role:'owner'}));vi.stubGlobal('fetch',fetch);
 const popup={close:vi.fn()} as unknown as Window;const open=vi.spyOn(window,'open').mockReturnValue(popup);const states:string[]=[];
 const broker=installLocalConnectionBroker({win:window,onState:s=>states.push(s)}),port=fakePort();
 window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity:identity()},ports:[port]}));
 await vi.waitFor(()=>expect(states.at(-1)).toBe('signin-required'));broker.signIn();expect(open).toHaveBeenCalledTimes(1);
 const login=new URL(open.mock.calls[0]![0] as string,location.origin),callback=new URL(login.searchParams.get('callbackUrl')!,location.origin),authNonce=new URLSearchParams(callback.hash.slice(1)).get('nonce');
 expect(callback.pathname).toBe('/local/connect');
 window.dispatchEvent(new MessageEvent('message',{origin:'https://untrusted.example',source:popup,data:{kind:'af:local-authenticated',nonce:authNonce}}));expect(fetch).toHaveBeenCalledTimes(2);
 window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:popup,data:{kind:'af:local-authenticated',nonce:authNonce}}));
 await vi.waitFor(()=>expect(states.at(-1)).toBe('permission-required'));expect(port.close).not.toHaveBeenCalled();expect(popup.close).toHaveBeenCalled();
 broker.authorize();await vi.waitFor(()=>expect(states.at(-1)).toBe('connected'));expect(JSON.stringify(vi.mocked(port.postMessage).mock.calls)).not.toContain('account-secret');broker.dispose();
});
it('reports blocked after successful popup login when the iframe still has no account session',async()=>{
 history.replaceState(null,'','/#nonce=test-nonce');const fetch=vi.fn().mockResolvedValue({ok:false,status:401,json:async()=>({})});vi.stubGlobal('fetch',fetch);
 const popup={close:vi.fn()} as unknown as Window;const open=vi.spyOn(window,'open').mockReturnValue(popup);const states:string[]=[];
 const broker=installLocalConnectionBroker({win:window,onState:s=>states.push(s)}),port=fakePort();
 window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity:identity()},ports:[port]}));await vi.waitFor(()=>expect(states.at(-1)).toBe('signin-required'));
 broker.signIn();const login=new URL(open.mock.calls[0]![0] as string,location.origin),callback=new URL(login.searchParams.get('callbackUrl')!,location.origin),nonce=new URLSearchParams(callback.hash.slice(1)).get('nonce');
 window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:popup,data:{kind:'af:local-authenticated',nonce}}));await vi.waitFor(()=>expect(states.at(-1)).toBe('blocked'));expect(states).not.toContain('connected');expect(port.close).not.toHaveBeenCalled();broker.dispose();
});
it('does not replay duplicate mutation calls and revokes an unavailable connection',async()=>{
 history.replaceState(null,'','/#nonce=test-nonce');
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({capability:'secret',role:'owner'})}).mockResolvedValueOnce({ok:true,text:async()=>'{"data":{"saved":true}}'}).mockResolvedValueOnce({ok:false,status:404,text:async()=>'{"error":"unavailable"}'}).mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetch);
 const states:string[]=[];const broker=installLocalConnectionBroker({win:window,onState:s=>states.push(s)}),port=fakePort();
 window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity:identity()},ports:[port]}));await vi.waitFor(()=>expect(states.at(-1)).toBe('connected'));
 const operation={kind:'operation',call:1,operation:{query:'mutation { tasks { add } }',operation:'mutation'}};
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
 const changed={compatible:false,role:'viewer',remoteDigest:'b'.repeat(64),remoteRevision:'2'};
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({capability:'guest-secret',role:'viewer'})}).mockResolvedValueOnce({ok:true,json:async()=>changed}).mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetch);
 const states:string[]=[];const broker=installLocalConnectionBroker({win:window,onState:s=>states.push(s)}),port=fakePort();
 try{
  window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity:identity()},ports:[port]}));await vi.advanceTimersByTimeAsync(0);expect(states.at(-1)).toBe('connected');
  await vi.advanceTimersByTimeAsync(15_000);expect(states.at(-1)).toBe('stale');
  expect(port.postMessage).toHaveBeenCalledWith({kind:'source-observation',remoteDigest:changed.remoteDigest,remoteRevision:'2'});
  const calls=fetch.mock.calls.length;await port.onmessage?.({data:{kind:'operation',call:1,operation:{query:'mutation { tasks { add } }'}}} as MessageEvent);expect(fetch).toHaveBeenCalledTimes(calls);
 }finally{broker.dispose();vi.useRealTimers();}
});
it('opens login securely without randomUUID and reports missing WebCrypto before opening a popup',async()=>{
 history.replaceState(null,'','/#nonce=test-nonce');const fetch=vi.fn().mockResolvedValue({ok:false,status:401,json:async()=>({})});vi.stubGlobal('fetch',fetch);const crypto=window.crypto;vi.stubGlobal('crypto',{getRandomValues:crypto.getRandomValues.bind(crypto)});
 const popup={close:vi.fn()} as unknown as Window;const open=vi.spyOn(window,'open').mockReturnValue(popup),states:string[]=[];
 const broker=installLocalConnectionBroker({win:window,onState:s=>states.push(s)}),port=fakePort();
 window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity:identity()},ports:[port]}));await vi.waitFor(()=>expect(states.at(-1)).toBe('signin-required'));
 broker.signIn();expect(open).toHaveBeenCalledTimes(1);vi.stubGlobal('crypto',undefined);expect(()=>broker.signIn()).toThrow(/Web ?Crypto|getRandomValues/);expect(states.at(-1)).toBe('blocked');expect(open).toHaveBeenCalledTimes(1);broker.dispose();
});
it('reports actual guest versus approved account scope only to trusted platform UI',async()=>{
 history.replaceState(null,'','/#nonce=test-nonce');let grants=0;
 const fetch=vi.fn().mockImplementation(async(_url,init)=>({ok:true,json:async()=>init?.method==='DELETE'?{}:++grants===1?{capability:'guest-secret',role:'viewer',authenticated:false}:{capability:'account-secret',role:'commenter',authenticated:true}}));vi.stubGlobal('fetch',fetch);
 const connected=vi.fn();const broker=installLocalConnectionBroker({win:window,onState:()=>{},onConnected:connected}),port=fakePort();
 window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity:identity()},ports:[port]}));await vi.waitFor(()=>expect(connected).toHaveBeenCalledTimes(1));expect(connected.mock.calls[0]![0]).toMatchObject({role:'viewer',authenticated:false});
 broker.authorize();await vi.waitFor(()=>expect(connected).toHaveBeenCalledTimes(2));expect(connected.mock.calls[1]![0]).toMatchObject({role:'commenter',authenticated:true});
 expect(JSON.stringify(vi.mocked(port.postMessage).mock.calls)).not.toContain('authenticated');broker.dispose();
});
it('revokes an idle status timeout but retains trusted recovery and retries only as a guest',async()=>{
 vi.useFakeTimers();history.replaceState(null,'','/#nonce=test-nonce');const fetch=vi.fn().mockImplementation(async(url)=>String(url).endsWith('/status')?new Promise(()=>{}):{ok:true,json:async()=>({capability:'guest-secret',role:'viewer',authenticated:false})});vi.stubGlobal('fetch',fetch);const states:string[]=[];const broker=installLocalConnectionBroker({win:window,onState:state=>states.push(state)}),port=fakePort();
 try{window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity:identity()},ports:[port]}));await vi.advanceTimersByTimeAsync(0);expect(states.at(-1)).toBe('connected');await vi.advanceTimersByTimeAsync(25_000);expect(states.at(-1)).toBe('blocked');expect(port.close).not.toHaveBeenCalled();const count=fetch.mock.calls.length;await vi.advanceTimersByTimeAsync(30_000);expect(fetch).toHaveBeenCalledTimes(count);broker.retry();await vi.advanceTimersByTimeAsync(0);expect(states.at(-1)).toBe('connected');const grants=fetch.mock.calls.filter(call=>call[1]?.method==='POST');expect(grants).toHaveLength(2);for(const grant of grants){expect(grant[1]).toMatchObject({credentials:'omit'});expect(JSON.parse(grant[1].body)).toMatchObject({authorizePrivate:false});}}
 finally{broker.dispose();vi.useRealTimers();}
});
