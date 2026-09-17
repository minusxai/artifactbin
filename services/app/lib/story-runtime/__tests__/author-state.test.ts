import {describe,it,expect} from 'vitest';
import {authorStateDelta} from '../author-state';
import type {DataflowState} from '@/lib/story/dataflow';

describe('author state delivery contract',()=>{
  const base: DataflowState={values:{view:'table',open:false},tables:{},errors:{}};
  it('does not resend unchanged tables for scalar changes',()=>{
    const next={...base,values:{...base.values,open:true}};
    expect(authorStateDelta(base,next)).toEqual({values:{open:true}});
  });
  it('sends no packet for unchanged state',()=>{
    expect(authorStateDelta(base,base)).toBeNull();
  });
  it('preserves large table identity and encodes removals as undefined',()=>{
    const table={columns:[],rows:Array.from({length:10000},()=>({a:1}))};
    const next={...base,tables:{big:table}};
    expect(authorStateDelta(base,next)?.tables?.big).toBe(table);
    expect(authorStateDelta(next,base)).toEqual({tables:{big:undefined}});
  });
  it('compares own properties including dangerous names and filters errors',()=>{
    const next={...base,values:JSON.parse('{"__proto__":1,"constructor":2}'),errors:{selected:'bad',other:'secret'}};
    const delta=authorStateDelta(null,next,{values:['__proto__','constructor'],tables:['selected']});
    expect(Object.keys(delta!.values!)).toEqual(['__proto__','constructor']);
    expect(delta!.errors).toEqual({selected:'bad'});
  });
  it('filters named subscriptions without leaking other values',()=>{
    expect(authorStateDelta(null,base,{values:['open'],tables:[]})).toMatchObject({values:{open:false}});
    expect(authorStateDelta(null,base,{values:['open'],tables:[]})?.values).not.toHaveProperty('view');
    expect(authorStateDelta(base,{...base,values:{...base.values,view:'dag'}},{values:['open'],tables:[]})).toBeNull();
  });
});
it('sends per-mutation capability changes and removals without account identity',()=>{
 const base={values:{},tables:{},errors:{},mutationAccess:{save:null}};
 expect(authorStateDelta(null,base)).toMatchObject({mutationAccess:{save:null}});
 expect(authorStateDelta(base,{...base,mutationAccess:{save:'Permission revoked'}})).toEqual({mutationAccess:{save:'Permission revoked'}});
 expect(authorStateDelta(base,{...base,mutationAccess:{}})).toEqual({mutationAccess:{save:undefined}});
});
