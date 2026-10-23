/* @jsxImportSource solid-js */
import {afterEach,expect,it,vi} from 'vitest';
import {waitFor} from '@testing-library/dom';
import {render} from '../../__tests__/helpers';
import {createReaderPresence} from '../create-reader-presence';
import type {DocumentRuntimeRef} from '@/lib/story-runtime/document-endpoint';
afterEach(()=>vi.unstubAllGlobals());
it('hides on pagehide and resumes a mounted session on BFCache pageshow',async()=>{
 let closed=0;
 vi.stubGlobal('EventSource',class {onmessage:unknown;close(){closed++;}});
 const published:Array<{visible:boolean}>=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init:RequestInit)=>{published.push(JSON.parse(init.body as string));return Response.json({id:'own'});}));
 const controller={send:()=>{},subscribe:()=>()=>{}} as unknown as NonNullable<DocumentRuntimeRef['current']>;
 const view=render(()=>{const session=createReaderPresence({id:'p',revision:'1',nonce:()=> 'n',enabled:()=>true,runtimeRef:{current:controller}});return <div>{session.viewers().length}</div>;});
 await waitFor(()=>expect(published.at(-1)?.visible).toBe(true));
 window.dispatchEvent(new Event('pagehide'));await waitFor(()=>expect(published.at(-1)?.visible).toBe(false));expect(closed).toBe(0);
 window.dispatchEvent(new Event('pageshow'));await waitFor(()=>expect(published.at(-1)?.visible).toBe(true));expect(closed).toBe(0);
 view.unmount();expect(closed).toBe(1);
});
