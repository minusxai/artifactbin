import {useEffect} from 'react';
import {EditorView} from '@codemirror/view';
import {act,fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PreviewWorkspace} from '../../../cli/src/preview/workspace';
import type {StoryController} from '@/lib/story-runtime/contract';
import {parseJsx} from '@/lib/jsx';

const state=vi.hoisted(()=>({listeners:new Set<(event:unknown)=>void>(),send:vi.fn(),update:vi.fn(),mounts:0}));
vi.mock('@/lib/story-runtime/EditorStoryRuntime',()=>({EditorStoryRuntime:({onController}:{onController:(value:StoryController|null)=>void})=>{
 useEffect(()=>{state.mounts++;onController({nonce:'test',send:state.send,update:state.update,subscribe:listener=>{state.listeners.add(listener);return()=>{state.listeners.delete(listener);};},invalidate:()=>{},dispose:()=>{},getViewportRect:()=>new DOMRect()});return()=>onController(null);},[onController]);
 return <div>Live document</div>;
}}));
vi.mock('@/lib/story/use-in-place-edit',()=>({useInPlaceEdit:()=>({commitPending:async()=>{},isUserEditing:()=>false})}));
const body='<p id="intro">Hello world</p>';
const parsed=parseJsx(body);if(!parsed.ok)throw Error('fixture');
const initial={body,revision:'one',data:{nodes:parsed.nodes,refData:{},assetsUrl:'/image',chrome:true,colorMode:'light' as const}};
let stored=body;
let reject=false;
let writes:Record<string,unknown>[]=[];
beforeEach(()=>{
 state.mounts=0;state.listeners.clear();state.send.mockClear();stored=body;reject=false;writes=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,options?:RequestInit)=>{
  const input=options?.body?JSON.parse(String(options.body)):null;
  let result:unknown=[];let ok=true;
  if(path==='/files')result=['report.jsx'];
  if(path.startsWith('/document'))result={...initial,body:stored};
  if(path==='/save'){ok=!reject;if(ok){stored=input.body;result={...initial,body:stored,revision:'two'};}else result={error:'File changed; draft retained'};}
  if(path==='/comments'&&input){writes.push(input);result={...input,id:'comment1'};}
  return {ok,json:async()=>result};
 }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('keeps the app mounted across tabs and saves code before returning to App',async()=>{
 render(<PreviewWorkspace initial={initial} file="report.jsx"/>);
 fireEvent.click(screen.getByRole('tab',{name:'Code'}));
 const source=await screen.findByRole('textbox',{name:'Markup source'});
 const view=EditorView.findFromDOM(source)!;
 act(()=>view.dispatch({changes:{from:0,to:view.state.doc.length,insert:'<p id="intro">New words</p>'}}));
 fireEvent.click(screen.getByRole('tab',{name:'App'}));
 await waitFor(()=>expect(screen.getByRole('tab',{name:'App'})).toHaveAttribute('aria-selected','true'));
 expect(state.mounts).toBe(1);expect(stored).toContain('New words');
});
it('retains a code draft and stays on Code when a save is refused',async()=>{
 render(<PreviewWorkspace initial={initial} file="report.jsx"/>);
 fireEvent.click(screen.getByRole('tab',{name:'Code'}));
 const source=await screen.findByRole('textbox',{name:'Markup source'});
 const view=EditorView.findFromDOM(source)!;
 act(()=>view.dispatch({changes:{from:0,to:view.state.doc.length,insert:'<p>Keep this draft</p>'}}));
 reject=true;
 fireEvent.click(screen.getByRole('tab',{name:'App'}));
 await screen.findByText('File changed; draft retained');
 expect(screen.getByRole('tab',{name:'Code'})).toHaveAttribute('aria-selected','true');
 expect(view.state.doc.toString()).toBe('<p>Keep this draft</p>');
});
it('creates a comment from a runtime selection without an element dropdown',async()=>{
 render(<PreviewWorkspace initial={initial} file="report.jsx"/>);
 fireEvent.click(screen.getByRole('button',{name:/Comments/}));
 fireEvent.click(screen.getByRole('button',{name:'Select content'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Select content'})).toHaveAttribute('aria-pressed','true'));
 const selection={nodeId:'intro',path:'0',kind:'text',tag:'p',rect:{x:0,y:0,width:100,height:20},className:'',style:'',ancestors:[],quote:'Hello'};
 await act(async()=>{for(const listener of state.listeners)listener({type:'mx:selection',nonce:'test',selection});});
 fireEvent.change(screen.getByRole('textbox',{name:'Your name'}),{target:{value:'Sam'}});
 fireEvent.change(screen.getByRole('textbox',{name:'Comment'}),{target:{value:'More detail'}});
 fireEvent.click(screen.getByRole('button',{name:'Post comment'}));
 await waitFor(()=>expect(writes).toHaveLength(1));
 expect(writes[0]).toMatchObject({node:'intro',quote:'Hello',text:'More detail'});
 expect(screen.queryByRole('combobox',{name:'Comment anchor'})).toBeNull();
});
