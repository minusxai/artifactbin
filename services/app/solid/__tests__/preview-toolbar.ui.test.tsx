/* @jsxImportSource solid-js */
/** The CLI preview uses the same compiled controller; raw source must own its save independently. */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,screen,waitFor} from '@testing-library/dom';
import {render} from 'solid-js/web';
import type {InPlaceEditOptions} from '@/solid/editor/create-in-place-edit';
import type {PreviewDocument} from '../../../cli/src/preview/types';
import {STORY_ROOT_ID} from '@/lib/story-runtime/contract';
const edit=vi.hoisted(()=>({options:null as InPlaceEditOptions|null,commit:vi.fn(),realController:false}));
vi.mock('@/solid/editor/create-in-place-edit',()=>({createInPlaceEdit:(options:InPlaceEditOptions)=>{edit.options=options;return {commitPending:edit.commit};}}));
vi.mock('@/solid/document/AnnotationLayer',()=>({AnnotationLayer:()=>null}));
vi.mock('../../../cli/src/preview/edit-controller',async(original)=>{const actual=await original<typeof import('../../../cli/src/preview/edit-controller')>();return {createPreviewEditController:(options:Parameters<typeof actual.createPreviewEditController>[0])=>edit.realController?actual.createPreviewEditController(options):({nonce:'test-session',selectionReady(){},dispose(){},update(){}})};});
vi.mock('../../../cli/src/preview/backend',()=>({createPreviewBackend:()=>({})}));
const initial={body:'<p id="words">Initial</p>',revision:'observed-revision',metadata:{title:'Report'},data:{nodes:[]}} as unknown as PreviewDocument;
let dispose:(()=>void)|undefined;
const reload=vi.fn(),fetch_=vi.fn();
beforeEach(()=>{
 document.body.innerHTML=`<div id="${STORY_ROOT_ID}"></div>`;edit.options=null;edit.realController=false;edit.commit.mockReset();reload.mockReset();fetch_.mockReset();
 vi.stubGlobal('location',{pathname:'/workspace/report.jsx',search:'?capture=1',reload});
 fetch_.mockResolvedValue(new Response('{}',{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetch_);
});
afterEach(()=>{dispose?.();dispose=undefined;vi.unstubAllGlobals();document.body.innerHTML='';});
async function mount(){const {Toolbar}=await import('../../../cli/src/preview/client');const host=document.createElement('div');document.body.append(host);dispose=render(()=> <Toolbar initial={initial} />,host);}
it('keeps the in-place controller inactive behind the raw source overlay',async()=>{
 await mount();fireEvent.click(screen.getByRole('button',{name:'Edit the source'}));
 await waitFor(()=>expect(screen.getByRole('textbox',{name:'Markup source'})).toBeDefined());
 expect(edit.options!.editing).toBe(false);expect(edit.commit).not.toHaveBeenCalled();
});
it('saves raw source without waiting for an unrelated compiled editor acknowledgement',async()=>{
 edit.commit.mockRejectedValue(Error('editor commit timed out'));await mount();
 fireEvent.click(screen.getByRole('button',{name:'Edit the source'}));
 const source=screen.getByRole('textbox',{name:'Markup source'});fireEvent.input(source,{target:{value:'<p id="words">Raw edit</p>'}});
 fireEvent.click(screen.getByRole('button',{name:'Done editing'}));
 await waitFor(()=>expect(fetch_).toHaveBeenCalledWith('/save',expect.objectContaining({body:JSON.stringify({file:'report.jsx',revision:'observed-revision',body:'<p id="words">Raw edit</p>'})})));
 expect(edit.commit).not.toHaveBeenCalled();await waitFor(()=>expect(reload).toHaveBeenCalledOnce());
});
it('flushes active in-place typing before capturing the source shown in code mode',async()=>{
 edit.commit.mockImplementation(async()=>{edit.options!.onSourceEdited('<p id="words">Last typed text</p>',false);});await mount();
 fireEvent.click(screen.getByRole('button',{name:'Edit document'}));expect(edit.options!.editing).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Edit the source'}));
 await waitFor(()=>expect(edit.commit).toHaveBeenCalledWith(true));
 await waitFor(()=>expect((screen.getByRole('textbox',{name:'Markup source'}) as HTMLTextAreaElement).value).toBe('<p id="words">Last typed text</p>'));expect(edit.options!.editing).toBe(false);
});
it('keeps in-place editing and its unsaved source available if the switch cannot collect pending typing',async()=>{
 edit.commit.mockRejectedValue(Error('editor commit timed out'));await mount();fireEvent.click(screen.getByRole('button',{name:'Edit document'}));fireEvent.click(screen.getByRole('button',{name:'Edit the source'}));
 await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('editor commit timed out'));
 expect(screen.queryByRole('textbox',{name:'Markup source'})).toBeNull();expect(edit.options!.editing).toBe(true);expect(fetch_).not.toHaveBeenCalledWith('/save',expect.anything());
});

it('renders a structural raw-source draft before Save while the in-place editor remains inactive',async()=>{
 edit.realController=true;edit.commit.mockRejectedValue(Error('editor commit timed out'));
 fetch_.mockImplementation(async(path:string)=>new Response(JSON.stringify(path==='/draft'?{html:'<html><body><div data-mx-inline-story><p id="words">Live raw edit</p></div></body></html>'}:{}),{headers:{'content-type':'application/json'}}));
 await mount();fireEvent.click(screen.getByRole('button',{name:'Edit the source'}));
 fireEvent.input(screen.getByRole('textbox',{name:'Markup source'}),{target:{value:'<p id="words">Live raw edit</p>'}});
 await waitFor(()=>expect(fetch_).toHaveBeenCalledWith('/draft',expect.objectContaining({body:JSON.stringify({file:'report.jsx',source:'<p id="words">Live raw edit</p>'})})));
 await waitFor(()=>expect(document.getElementById('words')?.textContent).toBe('Live raw edit'));
 expect(edit.options!.editing).toBe(false);expect(edit.commit).not.toHaveBeenCalled();expect(reload).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Done editing'}));await waitFor(()=>expect(reload).toHaveBeenCalledOnce());expect(edit.commit).not.toHaveBeenCalled();
});
