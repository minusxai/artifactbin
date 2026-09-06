import React from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { StoryRuntimeApp } from '../StoryRuntimeApp';
import { createDataflowStore, type QueryTransport } from '../store';
import type { DataflowState } from '@/lib/story/dataflow';
const columns = [{name:'id',type:'number' as const},{name:'item',type:'string' as const},{name:'hours',type:'number' as const}];
function setup(body = '<Column col="id"/><Column col="item"><input aria-label="Item" value="$_row.item" run="$set_item"/></Column><Column col="hours"><input aria-label="Hours {$_row.id}" type="number" value="$_row.hours" run="$set_hours"/></Column>', rows: DataflowState['tables'][string]['rows'] = [{id:1,item:'one',hours:2},{id:2,item:'two',hours:3}]) {
  const parsed=parseJsx('<Helmet><Query name="tasks">{`select * from ref_abc123`}</Query><Mutation name="set_item">{`update ref_abc123 set item=$_value where id=$_row.id`}</Mutation><Mutation name="set_hours">{`update ref_abc123 set hours=$_value where id=$_row.id`}</Mutation></Helmet><DataTable data="$tasks" rowKey="id">'+body+'</DataTable>');
  if (!parsed.ok) throw Error(parsed.error);
  const {content,body:nodes}=splitHelmet(parsed.nodes);
  const state:DataflowState={values:{},tables:{tasks:{columns,rows}},errors:{},mutationAccess:{set_item:null,set_hours:null}};
  const dataflow={flow:{values:content.values,queries:content.queries,mutations:content.mutations},state};
  const mutate=vi.fn().mockResolvedValue({dataset:'abc123'});
  const transport:QueryTransport={mutate,run:vi.fn().mockResolvedValue({tables:state.tables,errors:{}}),page:vi.fn()};
  const store=createDataflowStore(dataflow,{transport});
  const view=render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={true}/>);
  return {...view,store,mutate,transport,nodes,dataflow};
}
describe('editable table runtime',()=>{
  it('disables only denied mutation controls and retains a draft when permission is revoked',async()=>{
    const v=setup();const input=v.getByLabelText('Hours 1') as HTMLInputElement;
    fireEvent.focus(input);fireEvent.change(input,{target:{value:'7'}});
    await act(async()=>v.store.replaceFlow({...v.dataflow,state:{...v.dataflow.state,mutationAccess:{set_item:null,set_hours:'Edit access was revoked.'}}}));
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('aria-description')).toBe('Edit access was revoked.');
    expect(input.value).toBe('7');
    expect((v.getAllByLabelText('Item')[0] as HTMLInputElement).disabled).toBe(false);
    await expect(v.store.mutate('set_hours',{_value:7},{id:1,item:'one',hours:2})).rejects.toThrow('Edit access was revoked.');
    expect(v.mutate).not.toHaveBeenCalled();
  });
  it('refreshes quietly after a cell save while another cell remains editable',async()=>{
    const v=setup();let resolveRun!:(value:any)=>void;
    v.transport.run=vi.fn().mockImplementation(()=>new Promise(r=>{resolveRun=r;}));
    const first=v.getByLabelText('Hours 1') as HTMLInputElement;
    const second=v.getByLabelText('Hours 2') as HTMLInputElement;
    fireEvent.focus(first);fireEvent.change(first,{target:{value:'5'}});
    fireEvent.keyDown(first,{key:'Enter'});
    await act(async()=>{});
    const table=v.getByLabelText('DataTable embed');
    expect(table.getAttribute('aria-busy')).toBe('true');
    expect(table.classList.contains('mx-busy')).toBe(false);
    expect(first.disabled).toBe(true);
    expect(second.disabled).toBe(false);
    fireEvent.focus(second);fireEvent.change(second,{target:{value:'7'}});
    await act(async()=>resolveRun({tables:{tasks:{columns,rows:[{id:1,item:'one',hours:5},{id:2,item:'two',hours:3}]}},errors:{},mutationAccess:{set_item:null,set_hours:null}}));
    expect(first.value).toBe('5');
    expect(first.disabled).toBe(false);
    expect(second.value).toBe('7');
    expect(table.getAttribute('aria-busy')).toBe('false');
    fireEvent.keyDown(second,{key:'Enter'});await act(async()=>{});
    expect(v.mutate).toHaveBeenLastCalledWith({_value:7},'set_hours',{id:2,item:'two',hours:3});
    await act(async()=>resolveRun({tables:{tasks:{columns,rows:[{id:1,item:'one',hours:5},{id:2,item:'two',hours:7}]}},errors:{},mutationAccess:{set_item:null,set_hours:null}}));
  });
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
    await act(async()=>resolveRun({tables:{tasks:{columns,rows:[{id:1,item:'one',hours:null},{id:2,item:'two',hours:3}]}},errors:{},mutationAccess:{set_item:null,set_hours:null}}));
    expect(input.value).toBe('');
  });
  it('shows an error and disables editing for duplicate or null keys',()=>{
    const v=setup(undefined,[{id:1,item:'one',hours:2},{id:1,item:'two',hours:3}]);
    expect(v.getByRole('alert').textContent).toMatch(/unique|duplicate/i);
    expect(v.queryAllByLabelText('Item')).toHaveLength(0);
  });
  it('commits a single Select once and disables its actual trigger while saving',async()=>{
    const v=setup('<Column col="item"><Select label="Item {$_row.id}" value="$_row.item" options={["one","two","done"]} run="$set_item"/></Column>');
    v.mutate.mockImplementation(()=>new Promise(()=>{}));
    fireEvent.click(v.getByLabelText('Item 1'));
    fireEvent.click(v.getByLabelText('done'));
    await act(async()=>{});
    expect(v.mutate).toHaveBeenCalledTimes(1);
    expect(v.mutate).toHaveBeenCalledWith({_value:'done'},'set_item',{id:1,item:'one',hours:2});
    expect((v.getByLabelText('Item 1') as HTMLButtonElement).disabled).toBe(true);
  });
  it('renders capture cell controls disabled and updates when a write transport attaches',async()=>{
    const v=setup();
    const store=createDataflowStore(v.dataflow);
    const html=renderToString(<StoryRuntimeApp nodes={v.nodes} refData={{}} dataflow={v.dataflow} store={store} colorMode="light" chrome={true}/>);
    expect(html).toContain('disabled=""');
    await act(async()=>v.store.setTransport(null));
    expect((v.getByLabelText('Hours 1') as HTMLInputElement).disabled).toBe(true);
    await act(async()=>v.store.setTransport(v.transport));
    expect((v.getByLabelText('Hours 1') as HTMLInputElement).disabled).toBe(false);
  });
  it('retains an immutable draft across filtering out and remounting the same keyed row',async()=>{
    const v=setup();const input=v.getAllByLabelText('Item')[0];
    fireEvent.focus(input);fireEvent.change(input,{target:{value:'draft'}});
    await act(async()=>v.store.replaceFlow({...v.dataflow,state:{...v.dataflow.state,tables:{tasks:{columns,rows:[]}}}}));
    expect(v.queryAllByLabelText('Item')).toHaveLength(0);
    await act(async()=>v.store.replaceFlow({...v.dataflow,state:{...v.dataflow.state,tables:{tasks:{columns,rows:[{id:1,item:'changed elsewhere',hours:9}]}}}}));
    const remounted=v.getByLabelText('Item') as HTMLInputElement;expect(remounted.value).toBe('draft');
    fireEvent.keyDown(remounted,{key:'Enter'});await act(async()=>{});
    expect(v.mutate).toHaveBeenCalledWith({_value:'draft'},'set_item',{id:1,item:'one',hours:2});
  });
  it('multi Select keeps changes local until Done, preserves comma values, and cancels without writing',async()=>{
    const v=setup('<Column col="item"><Select label="Tags {$_row.id}" multiple allowCreate valueFormat="json" value="$_row.item" options={["feature","design,ux"]} run="$set_item"/></Column>',[{id:1,item:'[]',hours:2}]);
    fireEvent.click(v.getByLabelText('Tags 1'));fireEvent.click(v.getByLabelText('design,ux'));
    expect(v.mutate).not.toHaveBeenCalled();fireEvent.keyDown(v.getByLabelText('Search Tags 1'),{key:'Escape'});
    expect(v.mutate).not.toHaveBeenCalled();fireEvent.click(v.getByLabelText('Tags 1'));fireEvent.click(v.getByLabelText('design,ux'));fireEvent.click(v.getByLabelText('Done'));
    await act(async()=>{});expect(v.mutate).toHaveBeenCalledTimes(1);
    expect(v.mutate).toHaveBeenCalledWith({_value:'["design,ux"]'},'set_item',{id:1,item:'[]',hours:2});
  });
  it('binds a Select numeric value using query schema even when its original cell is null',async()=>{
    const v=setup('<Column col="hours"><Select label="Hours {$_row.id}" value="$_row.hours" options={[{value:1,label:"One"},{value:2,label:"Two"}]} run="$set_hours"/></Column>',[{id:1,item:'one',hours:null}]);
    fireEvent.click(v.getByLabelText('Hours 1'));fireEvent.click(v.getByLabelText('Two'));
    await act(async()=>{});expect(v.mutate).toHaveBeenCalledWith({_value:2},'set_hours',{id:1,item:'one',hours:null});
  });
  it('hydrates the SSR cell tree without changing its initial markup',async()=>{
    const v=setup(); const host=document.createElement('div');document.body.appendChild(host);
    const props={nodes:v.nodes,refData:{},dataflow:v.dataflow,colorMode:'light' as const,chrome:false};
    host.innerHTML=renderToString(<StoryRuntimeApp {...props}/>);
    const errors:unknown[]=[];let root:ReturnType<typeof hydrateRoot>;
    await act(async()=>{root=hydrateRoot(host,<StoryRuntimeApp {...props} store={v.store}/>,{onRecoverableError:e=>errors.push(e)});});
    expect(errors).toEqual([]);await act(async()=>root!.unmount());host.remove();
  });
  it('keeps hydrated capture controls disabled even when its query transport supports writes',()=>{
    const v=setup();v.unmount();
    const capture=render(<StoryRuntimeApp nodes={v.nodes} refData={{}} dataflow={v.dataflow} store={v.store} colorMode="light" chrome={false}/>);
    expect((capture.getByLabelText('Hours 1') as HTMLInputElement).disabled).toBe(true);
  });
  it('does not commit a number outside its native range or with bad input',async()=>{
    const v=setup('<Column col="hours"><input type="number" min={1} max={5} aria-label="Hours {$_row.id}" value="$_row.hours" run="$set_hours"/></Column>');
    const input=v.getByLabelText('Hours 1') as HTMLInputElement;
    fireEvent.focus(input);fireEvent.change(input,{target:{value:'6'}});fireEvent.blur(input);
    await act(async()=>{});expect(v.mutate).not.toHaveBeenCalled();
    Object.defineProperty(input,'validity',{configurable:true,value:{valid:false,badInput:true}});
    fireEvent.change(input,{target:{value:''}});fireEvent.keyDown(input,{key:'Enter'});
    await act(async()=>{});expect(v.mutate).not.toHaveBeenCalled();
  });
  it('coerces native select values from the invocation query column schema',async()=>{
    const v=setup('<Column col="hours"><select aria-label="Hours {$_row.id}" value="$_row.hours" run="$set_hours"><option value="">None</option><option value="2">Two</option></select></Column>',[{id:1,item:'one',hours:null}]);
    const input=v.getByLabelText('Hours 1');fireEvent.focus(input);fireEvent.change(input,{target:{value:'2'}});
    await act(async()=>{});expect(v.mutate).toHaveBeenCalledWith({_value:2},'set_hours',{id:1,item:'one',hours:null});
  });
});
