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

it('delegates preview reload and persists only an explicit viewer appearance choice',async()=>{
 const reload=vi.fn();window.addEventListener('af:preview-reload',reload);const page=session();await Promise.resolve();
 page.controls.onReloadPreview?.();expect(reload).toHaveBeenCalledOnce();expect(localStorage.getItem('af:local-color-mode')).toBeNull();
 page.controls.onMode?.('dark');expect(localStorage.getItem('af:local-color-mode')).toBe('dark');page.dispose();window.removeEventListener('af:preview-reload',reload);
});
it('starts linked autoconnection before chrome or DOMContentLoaded and accepts synchronous transport callbacks once',async()=>{
 document.head.innerHTML=`<script data-af="portable">${JSON.stringify({version:1,source:'<p>source</p>',identity})}</script>`;
 const ready=vi.spyOn(document,'readyState','get').mockReturnValue('loading');
 let mount!:()=>void;const loading=new Promise<{stylesheet:string;mountPortableChrome(options:PortableChromeOptions):{update:()=>void;dispose:()=>void}}>(resolve=>{mount=()=>resolve({stylesheet:'',mountPortableChrome:()=>({update(){},dispose(){}})});});
 const connection={retry:vi.fn(),signIn:vi.fn(),disconnect:vi.fn(),dispose:vi.fn(),post:vi.fn(),request:vi.fn()};
 const online=vi.fn(),attach=vi.fn(()=>({receive:vi.fn(),dispose:vi.fn()}));
 let transport!:Parameters<typeof import('../../local-connection/browser').connectLocalDocument>[0];
 const connect=vi.fn((callbacks:Parameters<typeof import('../../local-connection/browser').connectLocalDocument>[0])=>{transport=callbacks;callbacks.onState('connecting');callbacks.onState('connected');callbacks.onConnected?.({identity,role:'viewer'});return connection;});
 let dispose:undefined|(()=>void);
 try{dispose=startPortableSession({win:window,connect,attach,online,loadChrome:()=>loading});expect(connect).toHaveBeenCalledOnce();expect(attach).toHaveBeenCalledOnce();expect(online.mock.calls.filter(([value])=>value===true)).toEqual([[true,connection.request]]);expect(online).toHaveBeenCalledWith(false,undefined,true);transport.onState('connecting');transport.onState('connected');transport.onConnected?.({identity,role:'owner'});transport.onConnected?.({identity,role:'owner'});expect(attach).toHaveBeenCalledTimes(2);expect(online.mock.calls.filter(([value])=>value===true)).toHaveLength(2);mount();await Promise.resolve();}
 finally{dispose?.();ready.mockRestore();}
});
it('makes transport usable without a body, then mounts the frame after parsing and ignores an obsolete attempt',async()=>{
 document.head.innerHTML=`<script data-af="portable">${JSON.stringify({version:1,source:'<p>source</p>',identity})}</script>`;
 const body=document.body;body.remove();
 const callbacks:Array<Parameters<typeof import('../../local-connection/browser').connectLocalDocument>[0]>=[];
 const connection={retry:vi.fn(),signIn:vi.fn(),disconnect:vi.fn(),dispose:vi.fn(),post:vi.fn(),request:vi.fn()};
 const online=vi.fn(),attach=vi.fn(()=>({receive:vi.fn(),dispose:vi.fn()}));let controls!:PortableChromeOptions;
 const stop=startPortableSession({win:window,connect:options=>{callbacks.push(options);return connection;},attach,online,loadChrome:async()=>({stylesheet:'',mountPortableChrome(options){controls=options;return {update(){},dispose(){}};}})});
 try{callbacks[0]!.onState('connected');callbacks[0]!.onConnected?.({identity,role:'viewer'});expect(online).toHaveBeenCalledWith(true,connection.request);expect(attach).not.toHaveBeenCalled();document.documentElement.append(body);document.dispatchEvent(new Event('DOMContentLoaded'));await Promise.resolve();await Promise.resolve();expect(attach).toHaveBeenCalledOnce();controls.onConnect();const before=online.mock.calls.length;callbacks[0]!.onConnected?.({identity,role:'viewer'});expect(online).toHaveBeenCalledTimes(before);callbacks[1]!.onState('connecting');callbacks[1]!.onState('stale');expect(online.mock.lastCall).toEqual([false,undefined,false]);}
 finally{if(!document.body)document.documentElement.append(body);stop();}
});
