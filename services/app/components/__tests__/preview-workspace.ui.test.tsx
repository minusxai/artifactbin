/** Preview mounts the production chrome; storage protocol is exercised by CLI HTTP tests. */
import {useEffect,type ReactNode} from 'react';
import {act,fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PreviewWorkspace} from '../../../cli/src/preview/workspace';
import type {StoryController} from '@/lib/story-runtime/contract';
import {parseJsx} from '@/lib/jsx';
import {createDocumentGraph} from '@/lib/story/document-graph';
const state=vi.hoisted(()=>({listeners:new Set<(event:unknown)=>void>(),send:vi.fn(),mounts:0}));
vi.mock('@/components/TrustedUi',async original=>({...await original<object>(),TrustedUi:({children}:{children:ReactNode})=>children,useTrustedPortalContainer:()=>undefined}));
vi.mock('@/lib/story-runtime/EditorStoryRuntime',()=>({EditorStoryRuntime:({onController}:{onController:(value:StoryController|null)=>void})=>{
 useEffect(()=>{state.mounts++;onController({nonce:'test',send:state.send,update:()=>{},subscribe:listener=>{state.listeners.add(listener);return()=>{state.listeners.delete(listener);};},invalidate:()=>{},dispose:()=>{},getViewportRect:()=>new DOMRect(0,88,1000,800)});return()=>onController(null);},[onController]);
 return <div>Live document</div>;
}}));
vi.mock('@/lib/story/use-in-place-edit',()=>({useInPlaceEdit:()=>({selection:null,ready:true,commitPending:async()=>{},isUserEditing:()=>false,select:()=>{},spotlight:()=>{},pushDocument:()=>{},applyFormat:()=>{},applyLink:()=>{},applyInline:()=>{}})}));
vi.mock('@/lib/story/use-live-edits',()=>({FLUSH_DEBOUNCE_MS:500,useLiveEdits:()=>({state:{version:1,editId:'one',status:'',pending:false},queue:()=>{},flushNow:async()=>{},adoptRemote:()=>false,isOwnEdit:()=>false})}));
vi.mock('@/components/SolidSourceEditorPane',()=>({default:({value}:{value:string})=><textarea aria-label="Markup source" defaultValue={value}/>}));
const body='<p id="intro">Hello world</p>';
const parsed=parseJsx(body);if(!parsed.ok)throw Error('fixture');
const initial={body,revision:'one',metadata:{title:'Local document'},data:{nodes:parsed.nodes,refData:{},assetsUrl:'/image',chrome:true,colorMode:'light' as const}};
const head={document:createDocumentGraph(body,1),id:'local-preview',title:'Local document',markup:body,theme:null,template:null,colorMode:null,version:1,edit_id:'one'};
beforeEach(()=>{
 state.mounts=0;state.listeners.clear();state.send.mockClear();localStorage.clear();Object.defineProperty(window,'innerWidth',{value:1440,configurable:true});
 vi.stubGlobal('fetch',vi.fn(async(_path:string,options?:RequestInit)=>{
  const input=options?.body?JSON.parse(String(options.body)):null;
  return {ok:true,json:async()=>input?.operation==='load'?head:input?.operation==='css'?{css:''}:input?.operation==='queries'?{tables:{},errors:{}}:[]};
 }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('uses the production editor tabs, insert menu and selection panel, keeping the app mounted in Code',async()=>{
 render(<PreviewWorkspace initial={initial} file="report.jsx"/>);
 await screen.findByLabelText('Editor toolbar');
 expect(screen.getByRole('button',{name:'Insert'})).toBeTruthy();
 expect(screen.getByLabelText('Theme')).toBeTruthy();
 expect(screen.getByRole('tab',{name:'Selection'})).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'Edit the source'}));
 await screen.findByRole('textbox',{name:'Markup source'});
 expect(state.mounts).toBe(1);
 expect(screen.queryByText('Edit in place')).toBeNull();
});
it('opens the production inline composer from selected content without asking for a name',async()=>{
 render(<PreviewWorkspace initial={initial} file="report.jsx"/>);
 await screen.findByLabelText('Editor toolbar');
 await act(async()=>{for(const listener of state.listeners)listener({type:'mx:selection-action',nonce:'test',action:'annotate',selection:{nodeId:'intro',path:'0',kind:'text',tag:'p',rect:{x:100,y:200,width:300,height:30},className:'',style:'',ancestors:[],quote:'Hello'}});});
 await screen.findByRole('dialog',{name:'Annotation composer'});
 expect(screen.getByRole('textbox',{name:'Annotation comment'})).toBeTruthy();
 expect(screen.queryByRole('textbox',{name:'Your name'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Cancel annotation'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Annotation composer'})).toBeNull());
});
it('capture mode renders the document without editor or comment chrome',()=>{
 render(<PreviewWorkspace initial={initial} file="report.jsx" capture/>);
 expect(screen.getByText('Live document')).toBeTruthy();
 expect(screen.queryByLabelText('Editor toolbar')).toBeNull();
});
