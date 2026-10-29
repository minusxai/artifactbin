import {expect,it,vi} from 'vitest';
import type {HtmlCommentViewPort} from '..';
import {createHtmlCommentViewSession,installHtmlCommentView,withHtmlCommentView} from '../comment-view-session';
const view=(screen:string)=>({v:2,state:{$html:{version:'one',fields:{screen}}}}) as never;
/** A port over one declared field, recording every restore. */
function port(initial='home'){
 let screen=initial;const restores:string[]=[];
 const value:HtmlCommentViewPort={capture:()=>view(screen),restore:async input=>{const fields=(input as {state?:{$html?:{fields?:{screen?:unknown}}}}).state?.$html?.fields;if(typeof fields?.screen!=='string')throw Error('incompatible');screen=fields.screen;restores.push(screen);}};
 return {port:value,restores,get screen(){return screen;},set screen(next:string){screen=next;}};
}
it('attaches the captured view to a selection, reports a failed capture and passes through without a port',()=>{
 const owner={},p=port('detail');
 expect(withHtmlCommentView(owner,{path:'a'})).toEqual({path:'a'});
 installHtmlCommentView(owner,p.port);expect(withHtmlCommentView(owner,{path:'a'})).toEqual({path:'a',viewState:view('detail')});
 installHtmlCommentView(owner,{capture:()=>{throw Error('oversized');},restore:async()=>{}});
 expect(withHtmlCommentView(owner,{path:'a'})).toEqual({path:'a',viewStateError:expect.stringContaining('could not be saved')});
 installHtmlCommentView(owner,{capture:()=>null,restore:async()=>{}});expect(withHtmlCommentView(owner,{path:'a'})).toEqual({path:'a'});
 installHtmlCommentView(owner,undefined);expect(withHtmlCommentView(owner,{path:'a'})).toEqual({path:'a'});
 // The slot is a private symbol: it never enumerates or serializes with the owner.
 expect(Object.keys(owner)).toEqual([]);expect(JSON.stringify(owner)).toBe('{}');
});
it('restores a thread’s saved view on open, ignores duplicate commands and returns unchanged fields on close',async()=>{
 const owner={},p=port();installHtmlCommentView(owner,p.port);const session=createHtmlCommentViewSession(owner);
 const command={openId:'t1',pins:[{id:'t1',viewState:view('detail')}]};
 expect(await session.receive(command)).toBe(true);expect(p.screen).toBe('detail');
 expect(await session.receive(command)).toBe(false);expect(p.restores).toEqual(['detail']);
 expect(await session.receive({...command,viewStateRequest:1})).toBe(true);expect(p.restores).toEqual(['detail','detail']);
 expect(await session.receive({openId:null})).toBe(true);expect(p.screen).toBe('home');expect(session.error).toBeNull();
 // A thread without a saved view opens without touching the viewer's state.
 expect(await session.receive({openId:'t2',pins:[{id:'t2'}]})).toBe(true);expect(p.restores).toEqual(['detail','detail','home']);
});
it('serializes overlapping commands in arrival order',async()=>{
 const owner={},p=port();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 const restore=p.port.restore;p.port.restore=async input=>{await gate;await restore(input);};
 installHtmlCommentView(owner,p.port);const session=createHtmlCommentViewSession(owner);
 const first=session.receive({openId:'a',pins:[{id:'a',viewState:view('A')}]}),second=session.receive({openId:'b',pins:[{id:'b',viewState:view('B')}]});
 release();await Promise.all([first,second]);expect(p.restores).toEqual(['A','home','B']);expect(p.screen).toBe('B');
});
it('reports an incompatible or undeclared view against its thread and keeps going',async()=>{
 const owner={},p=port();installHtmlCommentView(owner,p.port);const session=createHtmlCommentViewSession(owner);
 await session.receive({openId:'bad',pins:[{id:'bad',viewState:{v:1}}]});expect(session.error).toEqual({id:'bad',message:expect.stringContaining('could not be restored')});
 await session.receive({openId:'ok',pins:[{id:'ok',viewState:view('detail')}]});expect(session.error).toBeNull();expect(p.screen).toBe('detail');
 const bare=createHtmlCommentViewSession({});await bare.receive({openId:'x',pins:[{id:'x',viewState:view('detail')}]});expect(bare.error?.id).toBe('x');
 const failing=createHtmlCommentViewSession({});const spy=vi.fn();await failing.receive({openId:null}).then(spy);expect(spy).toHaveBeenCalledWith(false);
});
