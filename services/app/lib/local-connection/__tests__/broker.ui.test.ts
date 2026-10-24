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
