/* @jsxImportSource solid-js */
import {createSignal} from 'solid-js';
import {afterEach,expect,it,vi} from 'vitest';
import {waitFor} from '@testing-library/dom';
import {render} from '../../__tests__/helpers';
import {createReaderPresence} from '../create-reader-presence';
import type {DocumentRuntimeRef} from '@/lib/story-runtime/document-endpoint';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('hides on pagehide and resumes a mounted session on BFCache pageshow',async()=>{
 let disconnected=0;
 const published:Array<{visible:boolean}>=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init:RequestInit)=>{published.push(JSON.parse(init.body as string));return Response.json({id:'own'});}));
 const controller={send:()=>{},subscribe:()=>()=>{disconnected++;}} as unknown as NonNullable<DocumentRuntimeRef['current']>;
 const view=render(()=>{const session=createReaderPresence({id:'p',revision:'1',nonce:()=> 'n',enabled:()=>true,runtimeRef:{current:controller},backend:{publishPresence:async input=>{published.push(input);return 'own';}}});return <div>{session.viewers().length}</div>;});
 await waitFor(()=>expect(published.at(-1)?.visible).toBe(true));
 window.dispatchEvent(new Event('pagehide'));await waitFor(()=>expect(published.at(-1)?.visible).toBe(false));expect(disconnected).toBe(0);
 window.dispatchEvent(new Event('pageshow'));await waitFor(()=>expect(published.at(-1)?.visible).toBe(true));expect(disconnected).toBe(0);
 view.unmount();expect(disconnected).toBe(1);
});

it('loads the session engine only for a ready bridge and fences disposal while loading',async()=>{
 const [enabled,setEnabled]=createSignal(false);
 let resolve!:(engine:typeof import('../reader-presence-engine'))=>void;
 const load=vi.fn(()=>new Promise<typeof import('../reader-presence-engine')>(done=>{resolve=done;}));
 const publish=vi.fn(async()=> 'own'),subscribe=vi.fn(()=>()=>{});
 const controller={send:vi.fn(),subscribe} as unknown as NonNullable<DocumentRuntimeRef['current']>;
 const view=render(()=>{createReaderPresence({id:'p',revision:'1',nonce:()=> 'n',enabled,runtimeRef:{current:controller},backend:{publishPresence:publish}},load);return <div/>;});
 expect(load).not.toHaveBeenCalled();
 setEnabled(true);await waitFor(()=>expect(load).toHaveBeenCalledTimes(1));
 view.unmount();resolve(await import('../reader-presence-engine'));await Promise.resolve();
 expect(publish).not.toHaveBeenCalled();expect(subscribe).not.toHaveBeenCalled();
});
it('does not start a stale session when readiness changes while its chunk loads',async()=>{
 const [enabled,setEnabled]=createSignal(true);
 let resolve!:(engine:typeof import('../reader-presence-engine'))=>void;
 const load=vi.fn(()=>new Promise<typeof import('../reader-presence-engine')>(done=>{resolve=done;}));
 const publish=vi.fn(async()=> 'own');
 const controller={send:vi.fn(),subscribe:vi.fn(()=>()=>{})} as unknown as NonNullable<DocumentRuntimeRef['current']>;
 const view=render(()=>{createReaderPresence({id:'p',revision:'1',nonce:()=> 'n',enabled,runtimeRef:{current:controller},backend:{publishPresence:publish}},load);return <div/>;});
 await waitFor(()=>expect(load).toHaveBeenCalledTimes(1));setEnabled(false);
 resolve(await import('../reader-presence-engine'));await Promise.resolve();
 expect(publish).not.toHaveBeenCalled();view.unmount();
});

it('retains the latest peer snapshot received while the session chunk loads',async()=>{
 let resolve!:(engine:typeof import('../reader-presence-engine'))=>void;
 const load=()=>new Promise<typeof import('../reader-presence-engine')>(done=>{resolve=done;});
 const controller={send:vi.fn(),subscribe:vi.fn(()=>()=>{})} as unknown as NonNullable<DocumentRuntimeRef['current']>;
 let presence!:ReturnType<typeof createReaderPresence>;
 const view=render(()=>{presence=createReaderPresence({id:'p',revision:'1',nonce:()=> 'n',enabled:()=>true,runtimeRef:{current:controller},backend:{publishPresence:async()=> 'own'}},load);return <div/>;});
 const peer={id:'peer',label:'Reader',revision:'1',seen:Date.now(),cursor:null,selection:null};
 presence.receive({viewers:[peer],total:31});resolve(await import('../reader-presence-engine'));
 await waitFor(()=>expect(presence.viewers()).toEqual([peer]));expect(presence.total()).toBe(30);view.unmount();
});

it('keeps preference changes and pagehide/pageshow that occur while loading',async()=>{
 let resolve!:(engine:typeof import('../reader-presence-engine'))=>void;
 const load=()=>new Promise<typeof import('../reader-presence-engine')>(done=>{resolve=done;});
 const published:Array<{visible:boolean;cursor:unknown}>=[];
 const controller={send:vi.fn(),subscribe:vi.fn(()=>()=>{})} as unknown as NonNullable<DocumentRuntimeRef['current']>;
 let presence!:ReturnType<typeof createReaderPresence>;
 const view=render(()=>{presence=createReaderPresence({id:'p',revision:'1',nonce:()=> 'n',enabled:()=>true,runtimeRef:{current:controller},backend:{publishPresence:async input=>{published.push(input);return 'own';}}},load);return <div/>;});
 presence.setPreference('shareCursor',false);window.dispatchEvent(new Event('pagehide'));
 resolve(await import('../reader-presence-engine'));
 await waitFor(()=>expect(published.at(-1)?.visible).toBe(false));
 expect(presence.preferences().shareCursor).toBe(false);
 window.dispatchEvent(new Event('pageshow'));await waitFor(()=>expect(published.at(-1)?.visible).toBe(true));
 expect(published.at(-1)?.cursor).toBeNull();view.unmount();
});

it('does not load optional presence while the host DOM is still parsing',async()=>{
 const state=vi.spyOn(document,'readyState','get').mockReturnValue('loading');
 const load=vi.fn(async()=>({startReaderPresence:vi.fn(()=>({receive:()=>{},update:()=>{},dispose:()=>{}}))}));
 const controller={send:vi.fn(),subscribe:vi.fn(()=>()=>{})} as unknown as NonNullable<DocumentRuntimeRef['current']>;
 const view=render(()=>{createReaderPresence({id:'p',revision:'1',nonce:()=> 'n',enabled:()=>true,runtimeRef:{current:controller},backend:{publishPresence:vi.fn(async()=> 'own')}},load);return <div/>;});
 expect(load).not.toHaveBeenCalled();
 state.mockReturnValue('interactive');document.dispatchEvent(new Event('DOMContentLoaded'));
 await waitFor(()=>expect(load).toHaveBeenCalledTimes(1));
 document.dispatchEvent(new Event('DOMContentLoaded'));expect(load).toHaveBeenCalledTimes(1);
 view.unmount();state.mockRestore();
});

it('never loads a disposed presence session when host parsing later finishes',()=>{
 const state=vi.spyOn(document,'readyState','get').mockReturnValue('loading');
 const load=vi.fn(async()=>({startReaderPresence:vi.fn(()=>({receive:()=>{},update:()=>{},dispose:()=>{}}))}));
 const controller={send:vi.fn(),subscribe:vi.fn(()=>()=>{})} as unknown as NonNullable<DocumentRuntimeRef['current']>;
 const view=render(()=>{createReaderPresence({id:'p',revision:'1',nonce:()=> 'n',enabled:()=>true,runtimeRef:{current:controller},backend:{publishPresence:vi.fn(async()=> 'own')}},load);return <div/>;});
 view.unmount();state.mockReturnValue('interactive');document.dispatchEvent(new Event('DOMContentLoaded'));
 expect(load).not.toHaveBeenCalled();state.mockRestore();
});

it('does not load presence disabled before host parsing finishes',()=>{
 const state=vi.spyOn(document,'readyState','get').mockReturnValue('loading');
 const [enabled,setEnabled]=createSignal(true);
 const load=vi.fn(async()=>({startReaderPresence:vi.fn(()=>({receive:()=>{},update:()=>{},dispose:()=>{}}))}));
 const controller={send:vi.fn(),subscribe:vi.fn(()=>()=>{})} as unknown as NonNullable<DocumentRuntimeRef['current']>;
 const view=render(()=>{createReaderPresence({id:'p',revision:'1',nonce:()=> 'n',enabled,runtimeRef:{current:controller},backend:{publishPresence:vi.fn(async()=> 'own')}},load);return <div/>;});
 setEnabled(false);state.mockReturnValue('interactive');document.dispatchEvent(new Event('DOMContentLoaded'));
 expect(load).not.toHaveBeenCalled();view.unmount();
});

it('retains a pagehide before host readiness and resumes that session on pageshow',async()=>{
 const state=vi.spyOn(document,'readyState','get').mockReturnValue('loading');
 const published:Array<{visible:boolean}>=[];
 const controller={send:vi.fn(),subscribe:vi.fn(()=>()=>{})} as unknown as NonNullable<DocumentRuntimeRef['current']>;
 const load=vi.fn(()=>import('../reader-presence-engine'));
 const view=render(()=>{createReaderPresence({id:'p',revision:'1',nonce:()=> 'n',enabled:()=>true,runtimeRef:{current:controller},backend:{publishPresence:async input=>{published.push(input);return 'own';}}},load);return <div/>;});
 window.dispatchEvent(new Event('pagehide'));expect(load).not.toHaveBeenCalled();
 state.mockReturnValue('interactive');document.dispatchEvent(new Event('DOMContentLoaded'));
 await waitFor(()=>expect(published.at(-1)?.visible).toBe(false));
 window.dispatchEvent(new Event('pageshow'));await waitFor(()=>expect(published.at(-1)?.visible).toBe(true));
 view.unmount();
});
