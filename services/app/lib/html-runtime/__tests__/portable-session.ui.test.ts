import {expect,it,vi,afterEach} from 'vitest';
import {startPortableSession} from '../portable-session';
import type {PortableChromeOptions} from '../portable-chrome-contract';
const identity={platformOrigin:'https://platform.example',artifactId:'p',baseRevision:'1',sourceDigest:'a'.repeat(64)};
afterEach(()=>{document.documentElement.removeAttribute('data-af-private-preview');document.head.innerHTML='';localStorage.clear();});
function session(linked=false){
 if(linked)document.head.innerHTML=`<script type="application/json" data-af="portable">${JSON.stringify({version:1,source:'<p>source</p>',identity})}</script>`;
 let controls!:PortableChromeOptions;
 const chrome={update:vi.fn(),dispose:vi.fn()};
 const connection={retry:vi.fn(),signIn:vi.fn(),disconnect:vi.fn(),dispose:vi.fn(),post:vi.fn(),request:vi.fn()};
 const connect=vi.fn((_options:Parameters<typeof import('../../local-connection/browser').connectLocalDocument>[0])=>connection);
 const dispose=startPortableSession({win:window,connect,attach:()=>({receive:vi.fn(),dispose:vi.fn()}),online:vi.fn(),loadChrome:async()=>({stylesheet:'css',mountPortableChrome(options){controls=options;return chrome;}})});
 return {get controls(){return controls;},chrome,connect,connection,dispose};
}
it('mounts the same local controls for unpublished files without contacting a platform',async()=>{
 const page=session();await Promise.resolve();
 expect(page.controls.kind).toBe('unpublished');expect(page.connect).not.toHaveBeenCalled();
 page.controls.onDisconnect();expect(page.chrome.dispose).not.toHaveBeenCalled();page.dispose();
});
it('keeps private preview local even when a linked file requests connection',async()=>{
 document.documentElement.setAttribute('data-af-private-preview','true');
 const page=session(true);await Promise.resolve();page.controls.onConnect();
 expect(page.connect).not.toHaveBeenCalled();expect(page.chrome.update).toHaveBeenCalledWith(expect.objectContaining({notice:expect.stringContaining('Private preview')}));page.dispose();
});
it('auto-attempts the original identity and retains local controls after disconnect or remembered offline',async()=>{
 const page=session(true);await Promise.resolve();
 expect(page.connect).toHaveBeenCalledOnce();expect(page.connect.mock.calls[0]?.[0]).toMatchObject({identity});
 page.controls.onStayOffline();expect(page.connection.dispose).toHaveBeenCalledOnce();expect(page.chrome.dispose).not.toHaveBeenCalled();page.dispose();
 const reopened=session(true);await Promise.resolve();expect(reopened.connect).not.toHaveBeenCalled();reopened.controls.onConnect();expect(reopened.connect).toHaveBeenCalledOnce();reopened.dispose();
});
