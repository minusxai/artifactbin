/* @jsxImportSource solid-js */
/** The CLI preview uses the same compiled controller; raw source must own its save independently. */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,waitFor} from '@testing-library/dom';
import {screen, trustedQuery} from './trusted-screen';
import {createSignal} from 'solid-js';
import {EditorView} from '@codemirror/view';
import {render} from 'solid-js/web';
import type {InPlaceEditOptions} from '@/solid/editor/create-in-place-edit';
import type {PreviewDocument} from '../../../cli/src/preview/types';
import {STORY_ROOT_ID} from '@/lib/story-runtime/contract';
const edit=vi.hoisted(()=>({options:null as InPlaceEditOptions|null,commit:vi.fn(),realController:false,ready:null as (()=>boolean)|null}));
vi.mock('@/solid/editor/create-in-place-edit',()=>({createInPlaceEdit:(options:InPlaceEditOptions)=>{edit.options=options;return {commitPending:edit.commit,ready:()=>edit.ready?.()??true};}}));
vi.mock('@/solid/document/AnnotationLayer',()=>({AnnotationLayer:()=>null}));
vi.mock('../../../cli/src/preview/edit-controller',async(original)=>{const actual=await original<typeof import('../../../cli/src/preview/edit-controller')>();return {createPreviewEditController:(options:Parameters<typeof actual.createPreviewEditController>[0])=>edit.realController?actual.createPreviewEditController(options):({nonce:'test-session',selectionReady(){},dispose(){},update(){}})};});
vi.mock('../../../cli/src/preview/backend',()=>({createPreviewBackend:()=>({})}));
const initial={body:'<p id="words">Initial</p>',revision:'observed-revision',metadata:{title:'Report'},data:{nodes:[]}} as unknown as PreviewDocument;
let dispose:(()=>void)|undefined;
const reload=vi.fn(),fetch_=vi.fn();
beforeEach(()=>{
 document.body.innerHTML=`<div id="${STORY_ROOT_ID}"></div>`;edit.options=null;edit.realController=false;edit.ready=null;edit.commit.mockReset();reload.mockReset();fetch_.mockReset();
 vi.stubGlobal('location',{pathname:'/workspace/report.jsx',search:'?capture=1',reload});
 fetch_.mockResolvedValue(new Response('{}',{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetch_);
});
afterEach(()=>{dispose?.();dispose=undefined;vi.unstubAllGlobals();document.body.innerHTML='';});
async function mount(){const {Toolbar}=await import('../../../cli/src/preview/client');const host=document.createElement('div');document.body.append(host);dispose=render(()=> <Toolbar initial={initial} />,host);}
async function code() {
 fireEvent.click(screen.getByRole('button',{name:'Edit'}));
 fireEvent.click(screen.getByRole('tab',{name:'Edit the source'}));
 await waitFor(()=>expect(trustedQuery('.cm-editor')).not.toBeNull());
 return EditorView.findFromDOM(trustedQuery('.cm-editor')!)!;
}
function replaceSource(view:EditorView,value:string){view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value},userEvent:'input.type'});}
it('waits for the compiled editor to be ready before offering Code, without dropping a commit during startup',async()=>{
 const [ready,setReady]=createSignal(false);edit.ready=ready;
 await mount();fireEvent.click(screen.getByRole('button',{name:'Edit'}));
 const tab=screen.getByRole('tab',{name:'Edit the source'});
 expect(tab.hasAttribute('disabled')).toBe(true);
 expect(screen.getByRole('button',{name:'Done editing'}).hasAttribute('disabled')).toBe(true);
 expect(screen.getByRole('status').textContent).toContain('Opening editor');
 expect(edit.commit).not.toHaveBeenCalled();
 setReady(true);expect(screen.getByRole('tab',{name:'Edit the source'}).hasAttribute('disabled')).toBe(false);
 expect(screen.getByRole('button',{name:'Done editing'}).hasAttribute('disabled')).toBe(false);
 fireEvent.click(screen.getByRole('tab',{name:'Edit the source'}));await waitFor(()=>expect(trustedQuery('.cm-editor')).not.toBeNull());
 expect(edit.commit).toHaveBeenCalledOnce();expect(edit.commit).toHaveBeenCalledWith(true);
});

it('keeps the in-place controller inactive behind the shared source pane',async()=>{
 await mount();await code();
 expect(edit.options!.editing).toBe(false);expect(edit.commit).toHaveBeenCalledOnce();expect(edit.commit).toHaveBeenCalledWith(true);
});
it('saves raw source without waiting for an unrelated compiled editor acknowledgement',async()=>{
 await mount();const source=await code();edit.commit.mockClear();edit.commit.mockRejectedValue(Error('editor commit timed out'));
 replaceSource(source,'<p id="words">Raw edit</p>');
 fireEvent.click(screen.getByRole('button',{name:'Done editing'}));
 await waitFor(()=>expect(fetch_).toHaveBeenCalledWith('/save',expect.objectContaining({body:JSON.stringify({file:'report.jsx',revision:'observed-revision',body:'<p id="words">Raw edit</p>'})})));
 expect(edit.commit).not.toHaveBeenCalled();await waitFor(()=>expect(reload).toHaveBeenCalledOnce());
});
it('flushes active in-place typing before capturing the source shown in code mode',async()=>{
 edit.commit.mockImplementation(async()=>{edit.options!.onSourceEdited('<p id="words">Last typed text</p>',false);});await mount();
 const source=await code();
 expect(edit.commit).toHaveBeenCalledWith(true);
 expect(source.state.doc.toString()).toBe('<p id="words">Last typed text</p>');expect(edit.options!.editing).toBe(false);
});
it('keeps in-place editing and its unsaved source available if the switch cannot collect pending typing',async()=>{
 edit.commit.mockRejectedValue(Error('editor commit timed out'));await mount();fireEvent.click(screen.getByRole('button',{name:'Edit'}));fireEvent.click(screen.getByRole('tab',{name:'Edit the source'}));
 await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('editor commit timed out'));
 expect(screen.queryByRole('textbox',{name:'Markup source'})).toBeNull();expect(edit.options!.editing).toBe(true);expect(fetch_).not.toHaveBeenCalledWith('/save',expect.anything());
});
it('renders a structural raw-source draft before Save while the in-place editor remains inactive',async()=>{
 edit.realController=true;
 fetch_.mockImplementation(async(path:string)=>new Response(JSON.stringify(path==='/draft'?{html:'<html><body><div data-mx-inline-story><p id="words">Live raw edit</p></div></body></html>'}:{}),{headers:{'content-type':'application/json'}}));
 await mount();const source=await code();edit.commit.mockClear();edit.commit.mockRejectedValue(Error('editor commit timed out'));
 replaceSource(source,'<p id="words">Live raw edit</p>');
 await waitFor(()=>expect(fetch_).toHaveBeenCalledWith('/draft',expect.objectContaining({body:JSON.stringify({file:'report.jsx',source:'<p id="words">Live raw edit</p>'})})));
 await waitFor(()=>expect(document.getElementById('words')?.textContent).toBe('Live raw edit'));
 expect(edit.options!.editing).toBe(false);expect(edit.commit).not.toHaveBeenCalled();expect(reload).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Done editing'}));await waitFor(()=>expect(reload).toHaveBeenCalledOnce());expect(edit.commit).not.toHaveBeenCalled();
});
