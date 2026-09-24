import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {MemoryRouter,Route,Routes,useLocation} from 'react-router';
import {DocumentPage} from '@/web/pages/Document';
afterEach(()=>vi.unstubAllGlobals());
function Destination(){return <p>{useLocation().pathname+useLocation().hash}</p>;}
it('creates an artifact before entering its shared editing surface',async()=>{
 const fetcher=vi.fn(async()=>({ok:true,json:async()=>({id:'abc123'})}));vi.stubGlobal('fetch',fetcher);
 render(<MemoryRouter initialEntries={['/documents/new']}><Routes><Route path="/documents/new" element={<DocumentPage/>}/><Route path="/a/:id" element={<Destination/>}/></Routes></MemoryRouter>);
 expect(screen.queryByRole('textbox',{name:'Document editor'})).toBeNull();
 fireEvent.change(screen.getByRole('textbox',{name:'Document title'}),{target:{value:'My MDX document'}});
 fireEvent.click(screen.getByRole('button',{name:'Create document'}));
 await waitFor(()=>expect(screen.getByText('/a/abc123#edit')).toBeTruthy());
 const body=JSON.parse((fetcher.mock.calls as unknown as Array<[string,{body:string}]>)[0][1].body);expect(body.title).toBe('My MDX document');expect(body.document.schemaVersion).toBe(1);
});
