import {bindManagedComments} from '../managed-comment-host';
import { EMPTY_COMPILED_DATAFLOW } from '@/lib/story/data/compiled-dataflow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startAuthorScript } from '../author-script';
import { createDataflowStore } from '../store';
import {managedAuthorDocument} from '../managed-author-document';
import {AUTHOR_FRAME_PATH} from '../author-frame';

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const mount=(doc=document)=>({host:doc.body,title:'Managed',html:'',scripts:[] as never[],document:managedAuthorDocument()});
describe('the managed frame\'s author realm', () => {
  // That the bootstrap PARSES is subsumed by managed-comment-bootstrap.test.ts, which
  // runs the shipped bootstrap — and the production-minified build of it — for real.
  it('coalesces selected signals, bounds unacknowledged packets, and cancels disposed delivery', async () => {
    vi.useFakeTimers();
    const port={postMessage:vi.fn(),start:vi.fn(),close:vi.fn(),onmessage:null as null | ((event:{data:unknown})=>void)};
    vi.stubGlobal('MessageChannel',class {port1=port;port2={};});
    const store=createDataflowStore({flow:{...EMPTY_COMPILED_DATAFLOW,values:[{kind:'scalar',name:'n',type:'number',default:0}]}});
    const dispose=startAuthorScript(store,mount());
    document.querySelector('iframe')!.dispatchEvent(new Event('load'));
    port.onmessage!({data:{id:1,op:'subscribe',names:['n']}});
    await vi.advanceTimersByTimeAsync(16);
    const packets = () => port.postMessage.mock.calls.map(call => call[0]).filter(packet => packet.type === 'signals');
    expect(packets()).toHaveLength(1);
    expect(packets()[0].updates[0]).toMatchObject({subscription:1,snapshot:{signals:{n:{value:0,status:'ready'}}}});
    for(let n=1;n<=100;n++)store.setValue('n',n);
    await vi.advanceTimersByTimeAsync(32);
    expect(packets()).toHaveLength(1);
    port.onmessage!({data:{type:'signals-ack'}});
    await vi.advanceTimersByTimeAsync(16);
    expect(packets()).toHaveLength(2);
    expect(packets()[1].updates[0].snapshot.signals.n.value).toBe(100);
    port.onmessage!({data:{type:'signals-ack'}});
    store.setValue('n',101); dispose();
    await vi.advanceTimersByTimeAsync(32);
    expect(packets()).toHaveLength(2);expect(port.close).toHaveBeenCalledOnce();
  });
  it('mounts one sandboxed frame on the fixed wrapper and hands it only the prepared content as data', () => {
    const port={postMessage:vi.fn(),start:vi.fn(),close:vi.fn(),onmessage:null};
    vi.stubGlobal('MessageChannel',class {port1=port;port2={};});
    const store = createDataflowStore({ flow: EMPTY_COMPILED_DATAFLOW });
    const cleanup = startAuthorScript(store, {...mount(), html:'<p>inside</p>', scripts:[{type:'classic',source:'window.__authorEscaped = true'}]});
    const frame = document.querySelector('iframe')!;
    expect(frame.title).toBe('Managed');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(document.querySelector('script')).toBeNull();
    expect((window as unknown as { __authorEscaped?: boolean }).__authorEscaped).toBeUndefined();
    expect(frame.srcdoc).toBe('');expect(new URL(frame.src).pathname).toBe(AUTHOR_FRAME_PATH);
    const post=vi.spyOn(frame.contentWindow!,'postMessage');frame.dispatchEvent(new Event('load'));
    expect(post).toHaveBeenCalledWith({type:'mx:author:init',document:managedAuthorDocument()},'*',[{}]);
    expect(port.postMessage).toHaveBeenCalledWith({type:'run',html:'<p>inside</p>',scripts:[{type:'classic',source:'window.__authorEscaped = true'}],assetOrigin:undefined,managed:true});
    cleanup();
    expect(document.querySelector('iframe')).toBeNull();
  });
  it('rejects replayed and descending asset ids before invoking the relay', async()=>{
    const port={postMessage:vi.fn(),start:vi.fn(),close:vi.fn(),onmessage:null as null|((event:{data:any})=>void)};
    vi.stubGlobal('MessageChannel',class {port1=port;port2={};});
    const relay=vi.fn(async()=>({url:'https://assets.example/assets/'+'a'.repeat(64)}));
    startAuthorScript(createDataflowStore({flow:EMPTY_COMPILED_DATAFLOW}),{...mount(),title:'x',assets:{origin:'https://assets.example',resolveUrl:'https://app.example/a/abc123/assets'},importAsset:relay},document);
    document.querySelector('iframe')!.dispatchEvent(new Event('load'));
    port.onmessage!({data:{op:'asset',id:5,url:'https://cdn.example/a.js',kind:'script'}});
    await vi.waitFor(()=>expect(relay).toHaveBeenCalledTimes(1));
    port.onmessage!({data:{op:'asset',id:5,url:'https://cdn.example/a.js',kind:'script'}});
    port.onmessage!({data:{op:'asset',id:4,url:'https://cdn.example/a.js',kind:'script'}});
    await Promise.resolve();expect(relay).toHaveBeenCalledTimes(1);
  });
  it('fails closed when the wrapper never completes its handshake',()=>{
    vi.useFakeTimers();
    const store=createDataflowStore({flow:EMPTY_COMPILED_DATAFLOW});
    startAuthorScript(store,mount());
    vi.advanceTimersByTime(15_000);
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/did not start/);
  });
});

it('connects only the visible managed owner and routes comment events outside author request IDs',()=>{
  const port={postMessage:vi.fn(),start:vi.fn(),close:vi.fn(),onmessage:null as null|((event:{data:any})=>void)};
  vi.stubGlobal('MessageChannel',class {port1=port;port2={};});
  document.body.innerHTML='<div id="owner" data-mx-managed-frame="" data-mx-ast="0"><div id="mount"></div></div>';
  const owner=document.getElementById('owner')!,receive=vi.fn();
  const binding=bindManagedComments(document,{state:()=>({enabled:true,picking:true,canComment:true,pins:[],openId:null,hoverId:null,selection:null}),receive});
  const dispose=startAuthorScript(createDataflowStore({flow:EMPTY_COMPILED_DATAFLOW}),{host:document.getElementById('mount')!,title:'Managed',html:'',scripts:[],document:managedAuthorDocument()},document);
  document.querySelector('iframe')!.dispatchEvent(new Event('load'));
  const state=port.postMessage.mock.calls.find(c=>c[0].type==='comment-state')![0];
  expect(state).toMatchObject({enabled:true,picking:true});
  port.onmessage!({data:{type:'comment-select-mode',generation:state.generation}});
  expect(receive).toHaveBeenCalledWith(owner,{type:'comment-select-mode',generation:state.generation});
  expect(port.postMessage.mock.calls.some(c=>c[0].error==='Invalid script request')).toBe(false);
  dispose();binding.dispose();expect(port.close).toHaveBeenCalledOnce();
});
