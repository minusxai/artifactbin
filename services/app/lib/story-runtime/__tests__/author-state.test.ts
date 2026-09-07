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
  it('filters named subscriptions without leaking other values',()=>{
    expect(authorStateDelta(null,base,{values:['open'],tables:[]})).toMatchObject({values:{open:false}});
    expect(authorStateDelta(null,base,{values:['open'],tables:[]})?.values).not.toHaveProperty('view');
    expect(authorStateDelta(base,{...base,values:{...base.values,view:'dag'}},{values:['open'],tables:[]})).toBeNull();
  });
});
