import {expect,it,vi,afterEach} from 'vitest';
import * as saver from '../save-local';
import {sha256Hex} from '@artifactbin/utils/sha256';
import {startPortableSession} from '../portable-session';
import type {PortableChromeOptions} from '../portable-chrome-contract';
const identity={platformOrigin:'https://platform.example',artifactId:'p',baseRevision:'1',sourceDigest:'a'.repeat(64)};
afterEach(()=>{document.documentElement.removeAttribute('data-af-private-preview');document.documentElement.removeAttribute('data-af-dark');document.head.innerHTML='';localStorage.clear();});
function session(linked=false,source='<p>source</p>'){
 if(linked)document.head.innerHTML=`<script type="application/json" data-af="portable">${JSON.stringify({version:1,source,identity})}</script>`;
 let controls!:PortableChromeOptions;
 const chrome={update:vi.fn(),setVisible:vi.fn(),dispose:vi.fn()};
 const connection={retry:vi.fn(),signIn:vi.fn(),disconnect:vi.fn(),dispose:vi.fn(),post:vi.fn(),request:vi.fn(),reportSource:vi.fn()};
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
it.each([
 ['false','light'],['true','dark'],[null,'light'],
] as const)('derives portable chrome mode from exact source theme %s',async(theme,expected)=>{
 if(theme!==null)document.documentElement.setAttribute('data-af-dark',theme);
 const source='<html data-af-dark="false"><head></head><body>source page</body></html>';
 const page=session(true,source);await Promise.resolve();
 expect(page.controls.mode).toBe(expected);page.dispose();
});
it('keeps the author source theme unchanged when the local viewer switches modes',async()=>{
 const source='<html data-af-dark="false"><head></head><body>authored source</body></html>';
 const page=session(true,source);await Promise.resolve();
 page.controls.onMode?.('dark');page.controls.onMode?.('light');
 const portable=JSON.parse(document.querySelector('script[data-af="portable"]')!.textContent??'{}') as {source:string};
 expect(portable.source).toBe(source);expect(localStorage.getItem('af:local-color-mode')).toBe('light');
 page.dispose();
});
it('starts linked autoconnection before chrome or DOMContentLoaded and accepts synchronous transport callbacks once',async()=>{
 document.head.innerHTML=`<script data-af="portable">${JSON.stringify({version:1,source:'<p>source</p>',identity})}</script>`;
 const ready=vi.spyOn(document,'readyState','get').mockReturnValue('loading');
 let mount!:()=>void;const loading=new Promise<{stylesheet:string;mountPortableChrome(options:PortableChromeOptions):{update:()=>void;setVisible:()=>void;dispose:()=>void}}>(resolve=>{mount=()=>resolve({stylesheet:'',mountPortableChrome:()=>({update(){},setVisible(){},dispose(){}})});});
 const connection={retry:vi.fn(),signIn:vi.fn(),disconnect:vi.fn(),dispose:vi.fn(),post:vi.fn(),request:vi.fn(),reportSource:vi.fn()};
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
 const connection={retry:vi.fn(),signIn:vi.fn(),disconnect:vi.fn(),dispose:vi.fn(),post:vi.fn(),request:vi.fn(),reportSource:vi.fn()};
 const online=vi.fn(),attach=vi.fn(()=>({receive:vi.fn(),dispose:vi.fn()}));let controls!:PortableChromeOptions;
 const stop=startPortableSession({win:window,connect:options=>{callbacks.push(options);return connection;},attach,online,loadChrome:async()=>({stylesheet:'',mountPortableChrome(options){controls=options;return {update(){},setVisible(){},dispose(){}};}})});
 try{callbacks[0]!.onState('connected');callbacks[0]!.onConnected?.({identity,role:'viewer'});expect(online).toHaveBeenCalledWith(true,connection.request);expect(attach).not.toHaveBeenCalled();document.documentElement.append(body);document.dispatchEvent(new Event('DOMContentLoaded'));await Promise.resolve();await Promise.resolve();expect(attach).toHaveBeenCalledOnce();controls.onConnect();const before=online.mock.calls.length;callbacks[0]!.onConnected?.({identity,role:'viewer'});expect(online).toHaveBeenCalledTimes(before);callbacks[1]!.onState('connecting');callbacks[1]!.onState('stale');expect(online.mock.lastCall).toEqual([false,undefined,false]);}
 finally{if(!document.body)document.documentElement.append(body);stop();}
});

it('hides the actual fallback overlay while a trusted broker owns connected or blocked recovery controls',async()=>{
 const page=session(true);await Promise.resolve();const frame=document.createElement('iframe');frame.dataset.afLocalBroker='';document.documentElement.append(frame);
 try{const callbacks=page.connect.mock.calls[0]![0];callbacks.onState('connected');expect(page.chrome.setVisible).toHaveBeenLastCalledWith(false);callbacks.onState('blocked');expect(page.chrome.setVisible).toHaveBeenLastCalledWith(false);frame.remove();callbacks.onState('blocked');expect(page.chrome.setVisible).toHaveBeenLastCalledWith(true);}
 finally{frame.remove();page.dispose();}
});

it('acquires Save evidence for B/L/R status, replays on reconnect and fences obsolete callbacks and disposal',async()=>{
 const source='<p>edited</p>',digest=sha256Hex(source);
 const save=vi.spyOn(saver,'saveLocalDocument').mockImplementation(async options=>{options.onSource?.(source);return true;});
 const page=session(true);await Promise.resolve();
 try{
  const first=page.connect.mock.calls[0]![0];first.onSourceObservation?.({remoteDigest:identity.sourceDigest,remoteRevision:'1'});
  expect(page.chrome.update).toHaveBeenLastCalledWith(expect.objectContaining({sourceStatus:'Current file bytes have not been verified.'}));
  await page.controls.onSave({includePrivateState:false});expect(page.connection.reportSource).toHaveBeenCalledWith(digest);
  expect(page.chrome.update).toHaveBeenCalledWith(expect.objectContaining({sourceStatus:'Local source has edits. Publish changes explicitly.'}));
  page.controls.onConnect();expect(page.connection.reportSource).toHaveBeenCalledTimes(2);
  first.onSourceObservation?.({remoteDigest:digest,remoteRevision:'2'});expect(page.chrome.update).not.toHaveBeenLastCalledWith(expect.objectContaining({sourceStatus:'Local and remote source match a newer revision.'}));
  page.connect.mock.calls[1]![0].onSourceObservation?.({remoteDigest:'c'.repeat(64),remoteRevision:'2'});
  expect(page.chrome.update).toHaveBeenLastCalledWith(expect.objectContaining({sourceStatus:'Local and remote source changed. Review both copies.'}));
  page.dispose();const count=page.chrome.update.mock.calls.length;first.onSourceObservation?.({remoteDigest:digest,remoteRevision:'2'});expect(page.chrome.update).toHaveBeenCalledTimes(count);
 }finally{page.dispose();save.mockRestore();}
});

it('ignores an actual-source Save completion after the portable session is disposed',async()=>{
 let finish!:()=>void;
 const spy=vi.spyOn(saver,'saveLocalDocument').mockImplementation(options=>new Promise(resolve=>{finish=()=>{options.onSource?.('<p>late</p>');resolve(true);};}));
 const page=session(true);await Promise.resolve();const saving=page.controls.onSave({includePrivateState:false});await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 page.dispose();const count=page.chrome.update.mock.calls.length;finish();await saving;expect(page.chrome.update).toHaveBeenCalledTimes(count);expect(page.connection.reportSource).not.toHaveBeenCalled();spy.mockRestore();
});
