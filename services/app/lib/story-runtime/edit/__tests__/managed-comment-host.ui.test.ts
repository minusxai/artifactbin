import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindManagedComments, connectManagedComments } from '../../managed-comment-host';
import type { ManagedCommentState } from '../../managed-comment-contract';

afterEach(() => {document.body.innerHTML='';});
describe('managed comment host boundary', () => {
  it('replays state to late frames and rejects forged generations, IDs and geometry', () => {
    const host=document.createElement('div');document.body.append(host);
    vi.spyOn(host,'getBoundingClientRect').mockReturnValue({x:100,y:200,width:400,height:300} as DOMRect);
    const receive=vi.fn();let enabled=true;
    const binding=bindManagedComments(document,{state:()=>({enabled,picking:true,canComment:true,pins:[{id:'one',target:{kind:'key',path:['row']}}],openId:'one',hoverId:null,selection:null}),receive});
    const states:ManagedCommentState[]=[];const connection=connectManagedComments(host,(state)=>states.push(state));
    expect(states.at(-1)).toMatchObject({enabled:true,picking:true,openId:'one'});
    const generation=states.at(-1)!.generation;
    connection.receive({type:'comment-pin',generation:'wrong',id:'one',rect:{x:0,y:0,width:2,height:3}});
    connection.receive({type:'comment-pin',generation,id:'other',rect:{x:0,y:0,width:2,height:3}});
    connection.receive({type:'comment-pin',generation,id:'one',rect:{x:NaN,y:0,width:2,height:3}});
    expect(receive).not.toHaveBeenCalled();
    connection.receive({type:'comment-pin',generation,id:'one',rect:{x:10,y:20,width:2,height:3}});
    expect(receive).toHaveBeenLastCalledWith(host,expect.objectContaining({rect:{x:110,y:220,width:2,height:3}}));
    enabled=false;binding.sync();receive.mockClear();
    connection.receive({type:'comment-select-mode',generation});expect(receive).not.toHaveBeenCalled();
    binding.dispose();connection.dispose();expect(states.at(-1)).toMatchObject({enabled:false,canComment:false,pins:[]});
  });
  it('binds session targets to this launch and does not accept nested target ranges', () => {
    const host=document.createElement('div');document.body.append(host);const receive=vi.fn();
    const binding=bindManagedComments(document,{state:()=>({enabled:true,picking:false,canComment:true,pins:[],openId:null,hoverId:null,selection:null}),receive});
    let generation='';const connection=connectManagedComments(host,(state)=>{generation=state.generation;});
    const selection={target:{kind:'session',generation:'old',id:'node'},rect:{x:0,y:0,width:10,height:10}};
    connection.receive({type:'comment-selection',generation,selection});expect(receive).not.toHaveBeenCalled();
    selection.target.generation=generation;
    connection.receive({type:'comment-selection',generation,selection});expect(receive).toHaveBeenCalledOnce();
    binding.dispose();connection.dispose();
  });
});
