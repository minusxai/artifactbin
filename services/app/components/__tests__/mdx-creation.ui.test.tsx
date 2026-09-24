import {createDocumentEditorState,editorDocument} from '@/lib/document/editor';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {MemoryRouter,Route,Routes,useLocation} from 'react-router';
import {assertDocument} from '@/lib/document/model';
import {validateDocumentMarkup,serializeDocumentMdx,parseDocumentMdx,reparseDocumentMdx} from '@/lib/document/mdx';
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

it('creates the case-study demo as editable Markdown and layouts in the same artifact flow',async()=>{
 const fetcher=vi.fn(async()=>({ok:true,json:async()=>({id:'demo12'})}));vi.stubGlobal('fetch',fetcher);
 render(<MemoryRouter initialEntries={['/documents/new?example=case-study']}><Routes><Route path="/documents/new" element={<DocumentPage/>}/><Route path="/a/:id" element={<Destination/>}/></Routes></MemoryRouter>);
 expect((screen.getByRole('combobox',{name:'Starting point'}) as HTMLSelectElement).value).toBe('case-study');
 fireEvent.click(screen.getByRole('button',{name:'Create document'}));await screen.findByText('/a/demo12#edit');
 const body=JSON.parse((fetcher.mock.calls as unknown as Array<[string,{body:string}]>)[0][1].body);
 expect(editorDocument(createDocumentEditorState(body.document).doc)).toEqual(body.document);expect(reparseDocumentMdx(body.document,serializeDocumentMdx(body.document,false))).toEqual(body.document);assertDocument(body.document);validateDocumentMarkup(body.document);expect(parseDocumentMdx(serializeDocumentMdx(body.document))).toEqual(body.document);
 const nodes=Object.values(body.document.nodes) as Array<{type:string;name?:string;tag?:string}>;expect(nodes.some(n=>n.type==='heading')).toBe(true);expect(nodes.filter(n=>n.type==='paragraph').length).toBeGreaterThan(40);expect(body.document.nodes[body.document.rootId].props.layout).toBe('canvas');expect(nodes.some(n=>n.name==='Iframe')).toBe(false);
});
