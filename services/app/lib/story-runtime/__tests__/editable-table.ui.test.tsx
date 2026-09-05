import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { StoryRuntimeApp } from '../StoryRuntimeApp';
import { createDataflowStore, type QueryTransport } from '../store';
import type { DataflowState } from '@/lib/story/dataflow';
const columns = [{name:'id',type:'number' as const},{name:'item',type:'string' as const},{name:'hours',type:'number' as const}];
function setup(body = '<Column col="id"/><Column col="item"><input aria-label="Item" value="$_row.item" run="$set_item"/></Column><Column col="hours"><input aria-label="Hours {$_row.id}" type="number" value="$_row.hours" run="$set_hours"/></Column>', rows = [{id:1,item:'one',hours:2},{id:2,item:'two',hours:3}]) {
  const parsed=parseJsx('<Helmet><Query name="tasks">{`select * from ref_abc123`}</Query><Mutation name="set_item">{`update ref_abc123 set item=$_value where id=$_row.id`}</Mutation><Mutation name="set_hours">{`update ref_abc123 set hours=$_value where id=$_row.id`}</Mutation></Helmet><DataTable data="$tasks" rowKey="id">'+body+'</DataTable>');
  if (!parsed.ok) throw Error(parsed.error);
  const {content,body:nodes}=splitHelmet(parsed.nodes);
  const state:DataflowState={values:{},tables:{tasks:{columns,rows}},errors:{}};
  const dataflow={flow:{values:content.values,queries:content.queries,mutations:content.mutations},state};
  const mutate=vi.fn().mockResolvedValue({dataset:'abc123'});
  const transport:QueryTransport={mutate,run:vi.fn().mockResolvedValue({tables:state.tables,errors:{}}),page:vi.fn()};
  const store=createDataflowStore(dataflow,{transport});
  const view=render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={false}/>);
  return {...view,store,mutate,transport};
}
describe('editable table runtime',()=>{
  it('keeps different row drafts isolated even when their labels are identical',()=>{
    const v=setup(); const inputs=v.getAllByLabelText('Item') as HTMLInputElement[];
    expect(inputs.map(i=>i.value)).toEqual(['one','two']);
    fireEvent.focus(inputs[0]);fireEvent.change(inputs[0],{target:{value:'changed'}});
    expect(inputs.map(i=>i.value)).toEqual(['changed','two']);
  });
  it('Escape followed by blur cancels without sending a write', async()=>{
    const v=setup();const input=v.getAllByLabelText('Item')[0];
    fireEvent.focus(input);fireEvent.change(input,{target:{value:'changed'}});
    fireEvent.keyDown(input,{key:'Escape'});fireEvent.blur(input);
    await act(async()=>{});expect(v.mutate).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('one');
  });
  it('Enter and blur send one typed null and retain the draft until authoritative refresh',async()=>{
    const v=setup();let resolveRun!:(value:any)=>void;
    v.transport.run=vi.fn().mockImplementation(()=>new Promise(r=>{resolveRun=r;}));
    const input=v.getByLabelText('Hours 1') as HTMLInputElement;
    fireEvent.focus(input);fireEvent.change(input,{target:{value:''}});
    fireEvent.keyDown(input,{key:'Enter'});fireEvent.blur(input);
    await act(async()=>{});
    expect(v.mutate).toHaveBeenCalledTimes(1);
    expect(v.mutate).toHaveBeenCalledWith({_value:null},'set_hours',{id:1,item:'one',hours:2});
    expect(input.value).toBe('');
    await act(async()=>resolveRun({tables:{tasks:{columns,rows:[{id:1,item:'one',hours:null},{id:2,item:'two',hours:3}]}},errors:{}}));
    expect(input.value).toBe('');
  });
  it('shows an error and disables editing for duplicate or null keys',()=>{
    const v=setup(undefined,[{id:1,item:'one',hours:2},{id:1,item:'two',hours:3}]);
    expect(v.getByRole('alert').textContent).toMatch(/unique|duplicate/i);
    expect(v.queryAllByLabelText('Item')).toHaveLength(0);
  });
});
