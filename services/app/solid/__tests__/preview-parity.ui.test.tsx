/* @jsxImportSource solid-js */
/**
 * The local preview behaves like the hosted document page for comments and concurrent edits: the selection bubble
 * is granted and its comment opens the composer on the picked words; following the file waits for unsent drafts;
 * an overlapping save keeps the draft and offers its ways out; every local comment can be deleted; and, while
 * editing, the format toolbar's Comment (or ⌘⌥M) opens the composer on what the editor has selected.
 */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,waitFor} from '@testing-library/dom';
import {screen} from './trusted-screen';
import {render} from 'solid-js/web';
import type {InPlaceEditOptions} from '@/solid/editor/create-in-place-edit';
import type {AnnotationLayerProps} from '@/solid/document/AnnotationLayer';
import type {StoryEditSelection} from '@/lib/edit-protocol';
import type {PreviewDocument} from '../../../cli/src/preview/types';
import {STORY_ROOT_ID} from '@/lib/story-runtime/contract';
import {createPreviewBackend} from '../../../cli/src/preview/backend';

const edit=vi.hoisted(()=>({options:null as InPlaceEditOptions|null,commit:vi.fn(),select:vi.fn(),setSelection:(_:StoryEditSelection|null)=>{}}));
const layer=vi.hoisted(()=>({props:null as AnnotationLayerProps|null}));
const runtime=vi.hoisted(()=>({sent:[] as Array<Record<string,unknown>>,listeners:new Set<(data:unknown)=>void>()}));
vi.mock('@/solid/editor/create-in-place-edit',async()=>{const {createSignal}=await import('solid-js');return {createInPlaceEdit:(options:InPlaceEditOptions)=>{
 const [selection,setSelection]=createSignal<StoryEditSelection|null>(null);edit.options=options;edit.setSelection=setSelection;
 return {commitPending:edit.commit,ready:()=>true,select:edit.select,selection,applyFormat:vi.fn(),applyLink:vi.fn(),applyInline:vi.fn(),applyMarkdownBlock:vi.fn(),applyMarkdownTable:vi.fn()};
}};});
vi.mock('@/solid/document/AnnotationLayer',()=>({AnnotationLayer:(props:AnnotationLayerProps)=>{layer.props=props;return null;}}));
vi.mock('../../../cli/src/preview/edit-controller',()=>({createPreviewEditController:()=>({
 nonce:'test-session',selectionReady(){},dispose(){},update(){},invalidate(){},getViewportRect:()=>new DOMRect(0,0,800,600),
 send:(message:Record<string,unknown>)=>{runtime.sent.push(message);},
 subscribe:(listener:(data:unknown)=>void)=>{runtime.listeners.add(listener);return()=>{runtime.listeners.delete(listener);};},
})}));
const initial={body:'<p id="words">Initial</p>',revision:'observed-revision',metadata:{title:'Report'},data:{nodes:[]}} as unknown as PreviewDocument;
const SELECTION={kind:'text',path:'0',tag:'p',nodeId:'words',rect:{x:5,y:6,width:200,height:40},className:'',style:'',ancestors:[],quote:'Initial'} as unknown as StoryEditSelection;
const emit=(data:Record<string,unknown>)=>{for(const listener of [...runtime.listeners])listener({nonce:'test-session',...data});};
const grants=()=>runtime.sent.filter(message=>message.type==='mx:selection-actions');
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const saves=()=>fetch_.mock.calls.filter(([path])=>path==='/save').map(([,init])=>JSON.parse(String((init as RequestInit).body)) as {revision:string;body:string});
let dispose:(()=>void)|undefined;
const reload=vi.fn(),fetch_=vi.fn();
beforeEach(()=>{
 document.body.innerHTML=`<div id="${STORY_ROOT_ID}"></div>`;
 edit.options=null;edit.commit.mockReset();edit.select.mockReset();layer.props=null;runtime.sent.length=0;runtime.listeners.clear();reload.mockReset();fetch_.mockReset();
 vi.stubGlobal('location',{pathname:'/workspace/report.jsx',search:'?capture=1',reload});
 fetch_.mockImplementation(async()=>json({}));vi.stubGlobal('fetch',fetch_);
});
afterEach(()=>{dispose?.();dispose=undefined;vi.useRealTimers();vi.unstubAllGlobals();document.body.innerHTML='';});
async function mount(){const {Toolbar}=await import('../../../cli/src/preview/client');const host=document.createElement('div');document.body.append(host);dispose=render(()=> <Toolbar initial={initial} />,host);}

it('grants the selection bubble and opens the composer on the words its comment action picked',async()=>{
 await mount();
 await waitFor(()=>expect(grants().at(-1)).toMatchObject({edit:true,annotate:true}));
 emit({type:'mx:selection-action',action:'annotate',selection:SELECTION});
 expect(layer.props!.initialSelection).toEqual(SELECTION);
 layer.props!.onSelectionConsumed!();
 expect(layer.props!.initialSelection).toBeNull();
 // While editing, the editor owns the document's selection: the bubble stands down, as on the hosted page.
 fireEvent.click(screen.getByRole('button',{name:'Edit'}));
 await waitFor(()=>expect(grants().at(-1)).toMatchObject({edit:false,annotate:false}));
});

it('opens the editor on the block the bubble\'s edit action names',async()=>{
 await mount();
 await waitFor(()=>expect(grants().at(-1)).toMatchObject({edit:true}));
 emit({type:'mx:selection-action',action:'edit',selection:SELECTION});
 await waitFor(()=>expect(edit.select).toHaveBeenCalledWith('0'));
 expect(screen.getByRole('button',{name:'Done editing'})).toBeTruthy();
});

it('follows a changed file only once no comment draft is open',async()=>{
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});
 fetch_.mockImplementation(async(path:string)=>json(path.startsWith('/document')?{...initial,revision:'agent-revision'}:{}));
 await mount();
 layer.props!.onDraftingChange!(true);
 await vi.advanceTimersByTimeAsync(4600);
 expect(reload).not.toHaveBeenCalled();
 layer.props!.onDraftingChange!(false);
 await vi.advanceTimersByTimeAsync(1600);
 expect(reload).toHaveBeenCalled();
});

it('keeps an overlapping draft, retries it from the revision it was made on, and offers both ways out',async()=>{
 const conflict='Another change edited the same part of report.jsx; your draft is kept.';
 fetch_.mockImplementation(async(path:string,init?:RequestInit)=>{
  if(path==='/save')return JSON.parse(String(init!.body)).revision==='observed-revision'?json({error:conflict},409):json({...initial,revision:'saved'});
  if(path.startsWith('/document'))return json({...initial,revision:'newer-revision'});
  return json({});
 });
 await mount();
 fireEvent.click(screen.getByRole('button',{name:'Edit'}));
 edit.options!.onSourceEdited('<p id="words">Mine</p>',false);
 fireEvent.click(screen.getByRole('button',{name:'Done editing'}));
 await waitFor(()=>expect(screen.getByRole('status').textContent).toBe(conflict));
 expect(reload).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Done editing'})).toBeTruthy();
 // Done again is the retry: the same draft, from the same base, never a silently refreshed revision.
 fireEvent.click(screen.getByRole('button',{name:'Done editing'}));
 await waitFor(()=>expect(saves()).toHaveLength(2));
 expect(saves().map(save=>save.revision)).toEqual(['observed-revision','observed-revision']);
 expect(saves().every(save=>save.body==='<p id="words">Mine</p>')).toBe(true);
 expect(reload).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Save my draft over the newer change'}));
 await waitFor(()=>expect(reload).toHaveBeenCalledOnce());
 expect(saves().at(-1)).toEqual({file:'report.jsx',revision:'newer-revision',body:'<p id="words">Mine</p>'});
});

it('discarding an overlapping draft shows the newer file without a leave prompt',async()=>{
 fetch_.mockImplementation(async(path:string)=>path==='/save'?json({error:'Another change edited the same part of report.jsx; your draft is kept.'},409):json({}));
 await mount();
 fireEvent.click(screen.getByRole('button',{name:'Edit'}));
 edit.options!.onSourceEdited('<p id="words">Mine</p>',false);
 fireEvent.click(screen.getByRole('button',{name:'Done editing'}));
 fireEvent.click(await screen.findByRole('button',{name:'Discard my draft and show the newer file'}));
 expect(reload).toHaveBeenCalledOnce();
 const leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);
 expect(leave.defaultPrevented).toBe(false);
});

it('comments from edit mode on what the editor selected, from the toolbar or ⌘⌥M, leaving the unsaved draft alone',async()=>{
 await mount();
 fireEvent.click(screen.getByRole('button',{name:'Edit'}));
 // An unsaved edit to the very node the comment lands on: commenting neither flushes nor saves it, as hosted.
 edit.options!.onSourceEdited('<p id="words">Mine</p>',false);
 edit.setSelection(SELECTION);
 fireEvent.click(await screen.findByRole('button',{name:'Comment on selection'}));
 expect(layer.props!.initialSelection).toEqual(SELECTION);
 layer.props!.onSelectionConsumed!();
 expect(layer.props!.initialSelection).toBeNull();
 fireEvent.keyDown(window,{key:'m',code:'KeyM',altKey:true,metaKey:true});
 expect(layer.props!.initialSelection).toEqual(SELECTION);
 layer.props!.onSelectionConsumed!();
 edit.options!.onCommentKey!();
 expect(layer.props!.initialSelection).toEqual(SELECTION);
 expect(edit.commit).not.toHaveBeenCalled();
 expect(saves()).toHaveLength(0);
 expect(screen.getByRole('status').textContent).toBe('Unsaved');
 // Nothing selected: the shortcut has nothing to comment on.
 layer.props!.onSelectionConsumed!();edit.setSelection(null);
 fireEvent.keyDown(window,{key:'m',code:'KeyM',altKey:true,metaKey:true});
 expect(layer.props!.initialSelection).toBeNull();
});

it('the edit toolbar\'s delete removes the selected block from the draft',async()=>{
 fetch_.mockImplementation(async(path:string,init?:RequestInit)=>path==='/save'?json({...initial,body:JSON.parse(String(init!.body)).body,revision:'saved'}):json({}));
 await mount();
 fireEvent.click(screen.getByRole('button',{name:'Edit'}));
 // A document keeps at least one block, so the draft has a second one.
 edit.options!.onSourceEdited('<p id="words">Initial</p><p id="more">More</p>',false);
 edit.setSelection(SELECTION);
 fireEvent.click(await screen.findByRole('button',{name:'Delete element'}));
 expect(edit.select).toHaveBeenCalledWith(null);
 fireEvent.click(screen.getByRole('button',{name:'Done editing'}));
 await waitFor(()=>expect(saves()).toHaveLength(1));
 expect(saves()[0]!.body).not.toContain('words');
 expect(saves()[0]!.body).toContain('id="more"');
});

it('lets the local author delete any local comment',()=>{
 expect(createPreviewBackend('report.jsx',()=>{}).canDeleteLocalAnnotation?.('any-comment-id')).toBe(true);
});
