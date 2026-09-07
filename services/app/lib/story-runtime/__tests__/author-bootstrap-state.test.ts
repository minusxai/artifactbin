import {runInNewContext} from 'node:vm';
import {describe,it,expect,vi} from 'vitest';
import {AUTHOR_SCRIPT_BOOTSTRAP} from '../author-script-bootstrap';

function boot() {
  let receive: (event:unknown)=>void=()=>{};
  const parent={};
  const port={postMessage:vi.fn(),start:vi.fn(),onmessage:null as null|((event:{data:unknown})=>void)};
  const window: Record<string,any>={};
  runInNewContext(AUTHOR_SCRIPT_BOOTSTRAP,{window,parent,structuredClone,console,setTimeout,clearTimeout,addEventListener:(_name:string,fn:typeof receive)=>{receive=fn;}});
  receive({source:parent,data:'mx:author:init',ports:[port]});
  const send=(state:unknown,pending:string[]=[],reset=false)=>port.onmessage!({data:{type:'state',state,pending,reset}});
  send({values:{view:'table',open:false},tables:{rows:{rows:[{a:1}],columns:[]}},errors:{}},[],true);
  return {mx:window.mx,send};
}
describe('author bootstrap delta delivery',()=>{
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
