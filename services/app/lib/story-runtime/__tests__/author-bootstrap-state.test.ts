import {runInNewContext} from 'node:vm';
import {describe,it,expect,vi} from 'vitest';
import {AUTHOR_SCRIPT_BOOTSTRAP} from '../author-script-bootstrap';

function boot() {
  let receive: (event:unknown)=>void=()=>{};
  const parent={};
  const port={postMessage:vi.fn(),start:vi.fn(),onmessage:null as null|((event:{data:unknown})=>void)};
  const window: Record<string,any>={};
  class Element {attributes:Record<string,string>={};setAttribute(name:string,value:string){this.attributes[name]=value;}}
  class HTMLImageElement extends Element {get src(){return this.attributes.src??'';}set src(value:string){this.attributes.src=value;}}
  class HTMLScriptElement extends HTMLImageElement {}
  class NativeXHR {}
  const document={body:{insertAdjacentHTML:vi.fn(),append:vi.fn()},createElement:()=>new HTMLScriptElement()};
  runInNewContext(AUTHOR_SCRIPT_BOOTSTRAP,{window,parent,document,Element,HTMLImageElement,HTMLScriptElement,XMLHttpRequest:NativeXHR,structuredClone,console,setTimeout,clearTimeout,fetch:vi.fn(),Headers,Response,Request,URL,AbortController,EventTarget,Event,addEventListener:(name:string,fn:typeof receive)=>{if(name==='message')receive=fn;}});
  receive({source:parent,data:'mx:author:init',ports:[port]});
  const send=(state:unknown,pending:string[]=[],reset=false)=>port.onmessage!({data:{type:'state',state,pending,reset}});
  send({values:{view:'table',open:false},tables:{rows:{rows:[{a:1}],columns:[]}},errors:{}},[],true);
  return {mx:window.mx,send,window,port,HTMLImageElement,HTMLScriptElement,NativeXHR};
}
describe('author bootstrap delta delivery',()=>{
  it('preserves native XHR for legacy non-managed Sandbox execution',()=>{
    const {port,window,NativeXHR}=boot();
    port.onmessage!({data:{type:'run',source:'',scripts:[]}});
    expect(window.XMLHttpRequest).toBe(NativeXHR);
  });
  it('rewrites dynamic src before native setters and ignores stale resolutions',async()=>{
    const {port,HTMLImageElement,HTMLScriptElement}=boot();
    port.onmessage!({data:{type:'run',managed:true,assetOrigin:'https://assets.example',scripts:[]}});
    const image=new HTMLImageElement();image.src='https://cdn.example/old';image.src='https://cdn.example/new';
    expect(image.src).toBe('');
    const requests=port.postMessage.mock.calls.map(call=>call[0]).filter(message=>message.op==='asset');
    expect(requests).toHaveLength(2);
    port.onmessage!({data:{id:requests[0].id,ok:true,value:'https://assets.example/assets/'+'a'.repeat(64)}});await Promise.resolve();
    expect(image.src).toBe('');
    const resolved='https://assets.example/assets/'+'b'.repeat(64);
    port.onmessage!({data:{id:requests[1].id,ok:true,value:resolved}});await Promise.resolve();
    expect(image.src).toBe(resolved);
    const script=new HTMLScriptElement();script.setAttribute('src','https://cdn.example/bundle');expect(script.src).toBe('');
    expect(port.postMessage.mock.calls.at(-1)![0]).toMatchObject({op:'asset',kind:'script'});
    const last=port.postMessage.mock.calls.at(-1)![0];port.onmessage!({data:{id:last.id,ok:false,error:'blocked'}});await Promise.resolve();
    expect(script.src).toBe('');
  });
  it('installs fail-closed GET fetch and asynchronous XHR before author code',async()=>{
    const {window}=boot();
    expect(typeof window.fetch).toBe('function');
    await expect(window.fetch('https://cdn.example/data')).rejects.toThrow(/configured/);
    const xhr=new window.XMLHttpRequest();
    expect(()=>xhr.open('POST','https://cdn.example')).toThrow();
    expect(()=>xhr.open('GET','https://cdn.example',false)).toThrow();
    expect(()=>xhr.setRequestHeader('X-Secret','yes')).toThrow();
  });
  it('merges deltas, dispatches only named changes, and unsubscribes',()=>{
    const {mx,send}=boot(); const listener=vi.fn();
    const stop=mx.params.subscribe(['open'],listener);
    send({values:{view:'dag'}}); expect(listener).not.toHaveBeenCalled();
    send({values:{open:true}}); expect(listener).toHaveBeenCalledWith({open:true});
    expect(mx.params.get('view')).toBe('dag'); expect(mx.data.get('rows').rows).toHaveLength(1);
    stop(); send({values:{open:false}}); expect(listener).toHaveBeenCalledTimes(1);
  });
  it('supports legacy listeners and selected errors/pending/deletions',()=>{
    const {mx,send}=boot(); const legacy=vi.fn(),selected=vi.fn();
    mx.params.subscribe(legacy); mx.data.subscribe(['rows'],selected);
    send({values:{view:'dag'}}); expect(legacy).toHaveBeenCalledWith({view:'dag',open:false});
    expect(selected).not.toHaveBeenCalled();
    send({errors:{rows:'bad'}},['rows']); expect(selected).toHaveBeenCalledTimes(1);
    expect(selected.mock.calls[0][0].errors).toEqual({rows:'bad'});
    send({tables:{rows:undefined},errors:{rows:undefined}}); expect(mx.data.get('rows')).toBeUndefined();
    expect(selected).toHaveBeenCalledTimes(2);
  });
  it('bounds and validates subscription names and listener counts',()=>{
    const {mx}=boot();
    for(const names of [1,[''],['a'.repeat(129)],Array(129).fill('a'),['__proto__'],['constructor']]) expect(()=>mx.params.subscribe(names,()=>{})).toThrow();
    for(let i=0;i<300;i++){const stop=mx.params.subscribe(['view'],()=>{});stop();}
    for(let i=0;i<128;i++)mx.params.subscribe(['view'],()=>{});
    expect(()=>mx.params.subscribe(['view'],()=>{})).toThrow();
  });
});
