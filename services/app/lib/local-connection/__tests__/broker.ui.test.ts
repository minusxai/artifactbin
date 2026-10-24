import {it,expect,vi,afterEach} from 'vitest';
import {installLocalConnectionBroker} from '../broker';
afterEach(()=>{vi.restoreAllMocks();history.replaceState(null,'','/');});
it('rejects unknown window sources and does not grant account authority from caller messages',async()=>{
 history.replaceState(null,'','/#nonce=test-nonce');
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const broker=installLocalConnectionBroker({win:window,onState:()=>{}});
 const identity={platformOrigin:location.origin,artifactId:'page123',baseRevision:'1',sourceDigest:'a'.repeat(64)};
 window.dispatchEvent(new MessageEvent('message',{origin:'null',source:{} as Window,data:{kind:'af:local-bind',nonce:'test-nonce',identity},ports:[]}));
 window.dispatchEvent(new MessageEvent('message',{origin:'https://untrusted.example',source:window,data:{kind:'af:local-bind',nonce:'test-nonce',identity},ports:[]}));
 await Promise.resolve();expect(fetch).not.toHaveBeenCalled();broker.dispose();vi.unstubAllGlobals();
});
