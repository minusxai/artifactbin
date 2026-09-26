import { describe, expect, it, vi } from 'vitest';
import { createDataflowStore } from '../store';
import { compiledOf } from '@/test/helpers/compiled';
const flow=await compiledOf('<Import name="items" src="ref:abc123" /><Value name="filter" default="backlog" /><Mutation name="edit">{`update items.rows set item=$_value where id=$_row.id`}</Mutation>',{abc123:[{name:'id',type:'number'},{name:'item',type:'string'}]});
describe('invocation-local cell mutations',()=>{
  it('checks and refreshes permissions even for a document with no queries',async()=>{
    const run=vi.fn().mockResolvedValue({tables:{},errors:{},mutationAccess:{edit:null}});
    const mutate=vi.fn().mockResolvedValue({dataset:'abc123'});
    const store=createDataflowStore({flow},{transport:{run,mutate,page:vi.fn()}});
    expect(store.canMutate('edit')).toBe(false);
    await expect(store.mutate('edit')).rejects.toThrow('Checking edit access');
    store.start();await Promise.resolve();
    expect(run).toHaveBeenCalledWith({filter:'backlog'},[]);
    expect(store.canMutate('edit')).toBe(true);
    run.mockResolvedValue({tables:{},errors:{},mutationAccess:{edit:'Read-only'}});
    store.invalidateDatasets(['abc123']);await Promise.resolve();
    expect(store.canMutate('edit')).toBe(false);
    await expect(store.mutate('edit')).rejects.toThrow('Read-only');
    expect(mutate).not.toHaveBeenCalled();
  });
  it('sends different rows concurrently, tracks busy until both finish, and never writes overrides globally',async()=>{
    const done:Array<()=>void>=[];
    const mutate=vi.fn().mockImplementation(()=>new Promise(resolve=>done.push(()=>resolve({dataset:'abc123'}))));
    const store=createDataflowStore({flow,state:{values:{},tables:{},errors:{},mutationAccess:{edit:null}}},{transport:{mutate,run:vi.fn().mockResolvedValue({tables:{},errors:{},mutationAccess:{edit:null}}),page:vi.fn()}});
    const a=store.mutate('edit',{_value:'a'},{id:1});
    const b=store.mutate('edit',{_value:'b'},{id:2});
    expect(mutate.mock.calls).toEqual([[{mutation:'edit',args:{},row:{id:1},value:'a'}],[{mutation:'edit',args:{},row:{id:2},value:'b'}]]);
    expect(store.getState().values).toEqual({filter:'backlog'});
    done[0]();await a;expect(store.mutating().has('edit')).toBe(true);
    done[1]();await b;expect(store.mutating().has('edit')).toBe(false);
  });
  it('sends a press with no row as the mutation and its arguments alone',async()=>{
    const mutate=vi.fn().mockResolvedValue({dataset:'abc123'});
    const store=createDataflowStore({flow,state:{values:{},tables:{},errors:{},mutationAccess:{edit:null}}},{transport:{mutate,run:vi.fn().mockResolvedValue({tables:{},errors:{},mutationAccess:{edit:null}}),page:vi.fn()}});
    await store.mutate('edit');
    expect(mutate).toHaveBeenCalledWith({mutation:'edit',args:{}});
  });
});
