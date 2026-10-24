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
