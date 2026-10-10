/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@solidjs/testing-library';
import {afterEach,expect,it,vi} from 'vitest';
import {RowActions} from '../Shelf';
const row={id:'doc123',url:'/a/doc123',title:'Report',format:'markup',version:1,updated_at:'2026-10-10'};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function open(level:'full'|'share'='full',removed=vi.fn(),groupId?:string){
 render(()=> <RowActions groupId={groupId} row={row} level={level} folders={[]} childCount={0} onRemoved={removed} onChanged={()=>{}}/>);
 if(level==='full'){fireEvent.click(screen.getByRole('button',{name:'More actions for Report'}));fireEvent.click(screen.getByRole('button',{name:'Transfer ownership of Report'}));}
 return removed;
}
it('requires confirmation to transfer an existing artifact into an editor group',async()=>{
 const fetcher=vi.fn(async(url:string)=>Response.json(url==='/api/groups'?{groups:[{id:'g1',handle:'team',name:'Team',description:'',role:'editor'},{id:'g2',handle:'readers',name:'Readers',description:'',role:'viewer'}]}:{ok:true}));vi.stubGlobal('fetch',fetcher);
 const removed=open();await screen.findByRole('option',{name:'Team'});expect(screen.queryByRole('option',{name:'Readers'})).toBeNull();
 fireEvent.change(screen.getByRole('combobox',{name:'New owner'}),{target:{value:'g1'}});expect(fetcher.mock.calls.some(([url])=>url.includes('/transfer'))).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Confirm ownership transfer'}));await waitFor(()=>expect(removed).toHaveBeenCalledWith('doc123'));
 expect(fetcher).toHaveBeenCalledWith('/api/artifacts/doc123/transfer',expect.objectContaining({method:'POST',body:JSON.stringify({destination:{type:'group',id:'g1'}})}));
});
it('keeps dependency refusals visible without removing the artifact',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/groups'?Response.json({groups:[{id:'g1',handle:'team',name:'Team',description:'',role:'editor'}]}):Response.json({message:'Transfer related datasets first.'},{status:409})));
 const removed=open();await screen.findByRole('option',{name:'Team'});fireEvent.change(screen.getByRole('combobox',{name:'New owner'}),{target:{value:'g1'}});fireEvent.click(screen.getByRole('button',{name:'Confirm ownership transfer'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Transfer related datasets first.');expect(removed).not.toHaveBeenCalled();expect(screen.getByRole('dialog',{name:'Transfer ownership of Report'})).toBeInTheDocument();
});
it('does not offer ownership transfer to viewers',()=>{open('share');expect(screen.queryByRole('button',{name:'Transfer ownership of Report'})).toBeNull();});

it('offers explicit Personal ownership for a group artifact and excludes its current group',async()=>{
 const fetcher=vi.fn(async(url:string)=>Response.json(url==='/api/groups'?{groups:[{id:'g1',handle:'team',name:'Team',description:'',role:'editor'}]}:{ok:true}));vi.stubGlobal('fetch',fetcher);
 const removed=vi.fn();open('full',removed,'g1');await screen.findByRole('option',{name:'Personal'});await waitFor(()=>expect(screen.queryByRole('option',{name:'Team'})).toBeNull());
 fireEvent.change(screen.getByRole('combobox',{name:'New owner'}),{target:{value:'personal'}});fireEvent.click(screen.getByRole('button',{name:'Confirm ownership transfer'}));await waitFor(()=>expect(removed).toHaveBeenCalled());
 expect(fetcher).toHaveBeenCalledWith('/api/artifacts/doc123/transfer',expect.objectContaining({body:JSON.stringify({destination:{type:'personal'}})}));
});
