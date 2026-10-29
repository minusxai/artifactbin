/* @jsxImportSource solid-js */
import {createSignal} from 'solid-js';
import {expect,it,vi} from 'vitest';
import {waitFor} from '@testing-library/dom';
import {render} from '../../__tests__/helpers';
import type {LinkedDocument,LocalConnectionState} from '@/lib/local-connection/contracts';
const captured=vi.hoisted(()=>({subscriptions:[] as any[]}));
vi.mock('../../editor/create-live-artifact',()=>({createLiveArtifact:(options:unknown)=>{captured.subscriptions.push(options);return ()=>null;}}));
vi.mock('../create-reader-presence',()=>({createReaderPresence:()=>({receive:vi.fn(),viewers:()=>[],preferences:()=>({})})}));
import {createLocalReader} from '../create-local-reader';
it('clears old comments and fences late events across reconnect, new identity and disposal',async()=>{
 const identity={artifactId:'first',baseRevision:'1',platformOrigin:'https://example.com',sourceDigest:'a'.repeat(64)} as LinkedDocument;
 const [id,setId]=createSignal(identity),[nonce,setNonce]=createSignal<string|null>('one'),[state,setState]=createSignal<LocalConnectionState>('connected');
 const changed=vi.fn(),invalidate=vi.fn();let reader!:ReturnType<typeof createLocalReader>;
 const view=render(()=>{reader=createLocalReader({identity:id,nonce,state,runtimeRef:{current:{invalidate} as any},sourceChanged:changed});return <div>{reader.annotations()?.length??'empty'}</div>;});
 await waitFor(()=>expect(captured.subscriptions.length).toBe(1));
 const first=captured.subscriptions[0];first.onAnnotations([{}]);expect(reader.annotations()).toHaveLength(1);
 setState('blocked');await waitFor(()=>expect(reader.annotations()).toBeNull());
 setNonce('two');setState('connected');await waitFor(()=>expect(captured.subscriptions.length).toBe(2));
 first.onAnnotations([{}]);first.onData({datasets:['private']});first.onPublication();first.onPresence({viewers:[],total:0});
 expect(reader.annotations()).toBeNull();expect(invalidate).not.toHaveBeenCalled();expect(changed).not.toHaveBeenCalled();
 const second=captured.subscriptions[1];second.onAnnotations([{},{}]);expect(reader.annotations()).toHaveLength(2);
 setId({...identity,artifactId:'second'});await waitFor(()=>expect(captured.subscriptions.length).toBe(3));expect(reader.annotations()).toBeNull();
 second.onPublication();expect(changed).not.toHaveBeenCalled();
 const current=captured.subscriptions[2];current.onData({datasets:['sales']});expect(invalidate).toHaveBeenCalledWith(['sales']);
 view.unmount();current.onPublication();expect(changed).not.toHaveBeenCalled();
});
