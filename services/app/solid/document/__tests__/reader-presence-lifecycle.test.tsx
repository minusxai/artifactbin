/* @jsxImportSource solid-js */
import {createSignal} from 'solid-js';
import {afterEach,expect,it,vi} from 'vitest';
import {waitFor} from '@testing-library/dom';
import {render} from '../../__tests__/helpers';
import {createReaderPresence} from '../create-reader-presence';
import type {DocumentRuntimeRef} from '@/lib/story-runtime/document-endpoint';
afterEach(()=>vi.unstubAllGlobals());
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
 presence.receive([peer]);resolve(await import('../reader-presence-engine'));
 await waitFor(()=>expect(presence.viewers()).toEqual([peer]));view.unmount();
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
