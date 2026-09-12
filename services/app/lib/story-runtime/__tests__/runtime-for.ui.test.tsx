import {expect,it} from 'vitest';
import {act,screen,waitFor} from '@testing-library/react';
import {renderWithProviders} from '@/test/helpers/render-with-providers';
import {StoryRuntimeApp} from '../StoryRuntimeApp';
import {createDataflowStore} from '../store';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
it('subscribes For to actual query table results and preserves DOM identity after refresh',async()=>{
 const parsed=parseJsxOrThrow('<For id="orders" each={$orders} keyBy="id"><p id="name">{$_row.name}</p></For>');
 let rows=[{id:'a',name:'Alice'}];
 const store=createDataflowStore({flow:{values:[],queries:[{name:'orders',sql:'select * from ref_abc123',params:[],refs:['abc123'],start:0,end:0}]}},{transport:{page:async()=>{throw new Error('not used')},run:async()=>({tables:{orders:{rows,columns:[{name:'id',type:'string'},{name:'name',type:'string'}]}},errors:{}})}});
 const view=renderWithProviders(<StoryRuntimeApp nodes={parsed.nodes} refData={{}} store={store} colorMode="light" chrome={false}/>);
 await act(async()=>store.start());await waitFor(()=>expect(screen.getByText('Alice')).toBeTruthy());const alice=screen.getByText('Alice');
 rows=[{id:'b',name:'Bob'},{id:'a',name:'Alicia'}];await act(async()=>store.refresh());
 await waitFor(()=>expect(screen.getByText('Alicia')).toBe(alice));expect(screen.getByText('Bob')).toBeTruthy();
 view.unmount();store.dispose();
});
