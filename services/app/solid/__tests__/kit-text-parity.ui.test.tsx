/* @jsxImportSource solid-js */
/**
 * A KIT TEXT COMPONENT IS EDITED THE SAME WAY ON THE HOSTED PAGE AND IN THE LOCAL PREVIEW: the document's selection
 * of a kit table cell offers the marks its text takes and none of the class algebra (its classes are the kit's), the
 * typed text lands in the cell's children with its id and props unchanged, and a cell whose text comes from data
 * says so. The real `createInPlaceEdit` runs behind both pages; only the document runtime is faked, as each page's
 * own suite fakes it.
 */
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,waitFor} from '@testing-library/dom';
import {Route,Router} from '@solidjs/router';
import {render} from 'solid-js/web';
import {screen} from './trusted-screen';
import type {DocumentRuntimeRef} from '@/lib/story-runtime/document-endpoint';
import type {PendingChange} from '@/solid/editor/create-live-edits';
import type {PreviewDocument} from '../../../cli/src/preview/types';
import {STORY_ROOT_ID} from '@/lib/story-runtime/contract';
import {fakeBackend} from '@/test/helpers/artifact-backend';

/** A dashboard: a kit table with a typed cell and a cell from data. */
const BODY='<Table id="t"><TableBody id="tb"><TableRow id="r"><TableCell id="eVAF" className="font-medium">Wed</TableCell><TableCell id="tot">{$q.rows[0].total}</TableCell></TableRow></TableBody></Table>';
const CELL='0.0.0.0',DATA_CELL='0.0.0.1';
const RECT={x:5,y:6,width:200,height:40};
const TYPING={kind:'text',mode:'typing',path:CELL,tag:'TableCell',nodeId:'eVAF',rect:RECT,className:'p-2 font-medium',style:'',ancestors:[{path:'0',tag:'Table',hint:''}]};
const LOCKED={kind:'embed',mode:'block',path:DATA_CELL,tag:'TableCell',nodeId:'tot',rect:RECT,className:'p-2',style:'',ancestors:[{path:'0',tag:'Table',hint:''}],textLock:'Text comes from data'};

const queued=vi.hoisted(()=>[] as PendingChange[]);
vi.mock('@/solid/editor/create-live-edits',async(importOriginal)=>{
 const real=await importOriginal<typeof import('@/solid/editor/create-live-edits')>();
 return {...real,createLiveEdits:(options:Parameters<typeof real.createLiveEdits>[0])=>{const live=real.createLiveEdits(options);const queue=live.queue;live.queue=(change)=>{queued.push(change);queue(change);};return live;}};
});
vi.mock('@/solid/editor/SourceEditor',()=>({default:()=>null}));
vi.mock('@/solid/document/AnnotationLayer',()=>({AnnotationLayer:()=>null}));
const runtime=vi.hoisted(()=>({listeners:new Set<(data:unknown)=>void>()}));
vi.mock('../../../cli/src/preview/edit-controller',()=>({createPreviewEditController:()=>({
 nonce:'preview-session',selectionReady(){},dispose(){},update(){},invalidate(){},getViewportRect:()=>new DOMRect(0,0,800,600),
 send:(message:{type?:string})=>{if(message.type==='mx:commit')queueMicrotask(()=>{for(const listener of [...runtime.listeners])listener({type:'mx:committed',nonce:'preview-session'});});},
 subscribe:(listener:(data:unknown)=>void)=>{runtime.listeners.add(listener);return()=>{runtime.listeners.delete(listener);};},
})}));

const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const fetch_=vi.fn(),reload=vi.fn();
let dispose:(()=>void)|undefined;
beforeEach(()=>{
 queued.length=0;runtime.listeners.clear();fetch_.mockReset();reload.mockReset();
 vi.stubGlobal('matchMedia',(query:string)=>({matches:false,media:query,onchange:null,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){},dispatchEvent:()=>false}));
});
afterEach(()=>{dispose?.();dispose=undefined;vi.unstubAllGlobals();document.body.innerHTML='';window.history.replaceState(null,'','/');});

interface Page {emit(data:Record<string,unknown>):void; saved():Promise<string>}

/** The hosted editor page over BODY, its document runtime faked. */
async function hosted(body=BODY):Promise<Page>{
 const NONCE='n'.repeat(24);
 let onEvent:((data:unknown)=>void)|null=null;
 const runtimeRef:DocumentRuntimeRef={current:{send:(msg:{type?:string})=>{if(msg.type==='mx:commit')queueMicrotask(()=>onEvent?.({type:'mx:committed',nonce:NONCE}));},subscribe:(fn:(data:unknown)=>void)=>{onEvent=fn;return()=>{onEvent=null;};},getViewportRect:()=>new DOMRect()} as never};
 const {default:InPlaceEditor}=await import('@/solid/editor/InPlaceEditor');
 const art={id:'doc12345',version:3,edit_id:'edit-3',title:'Dashboard',theme:null,template:null,colorMode:null,markup:body,
  document:{schema:3 as const,kind:'graph' as const,policy:'',nodes:{},claimedIds:{},bytes:0}};
 const host=document.createElement('div');document.body.append(host);
 dispose=render(()=> <Router><Route path="/" component={()=> <InPlaceEditor art={art} backend={fakeBackend()} runtimeRef={runtimeRef} sessionNonce={NONCE} />} /></Router>,host);
 const emit=(data:Record<string,unknown>)=>onEvent?.({...data,nonce:NONCE});
 emit({type:'mx:edit-ready'});
 return {emit,saved:async()=>{await waitFor(()=>expect(queued.length).toBeGreaterThan(0));return queued.at(-1)!.source!;}};
}

/** The local preview over BODY (`afbin preview`), its document controller faked. */
async function preview(body=BODY):Promise<Page>{
 document.body.innerHTML=`<div id="${STORY_ROOT_ID}"></div>`;
 vi.stubGlobal('location',{pathname:'/workspace/dashboard.jsx',search:'',reload});
 fetch_.mockImplementation(async(path:string,init?:RequestInit)=>path==='/save'?json({body:JSON.parse(String(init!.body)).body,revision:'saved'}):json({}));
 vi.stubGlobal('fetch',fetch_);
 const {Toolbar}=await import('../../../cli/src/preview/client');
 const initial={body,revision:'observed-revision',metadata:{title:'Dashboard'},data:{nodes:[]}} as unknown as PreviewDocument;
 const host=document.createElement('div');document.body.append(host);
 dispose=render(()=> <Toolbar initial={initial} />,host);
 fireEvent.click(screen.getByRole('button',{name:'Edit'}));
 const emit=(data:Record<string,unknown>)=>{for(const listener of [...runtime.listeners])listener({...data,nonce:'preview-session'});};
 emit({type:'mx:edit-ready'});
 return {emit,saved:async()=>{
  fireEvent.click(screen.getByRole('button',{name:'Done editing'}));
  await waitFor(()=>expect(fetch_.mock.calls.some(([path])=>path==='/save')).toBe(true));
  const save=fetch_.mock.calls.find(([path])=>path==='/save')!;
  return (JSON.parse(String((save[1] as RequestInit).body)) as {body:string}).body;
 }};
}

describe.each([['the hosted editor',hosted],['the local preview',preview]] as const)('a kit table cell in %s',(_name,open)=>{
 it('offers the marks its text takes, types into its children only, and says why a data cell takes no caret',async()=>{
  const page=await open();
  page.emit({type:'mx:selection',selection:TYPING});
  await screen.findByRole('button',{name:'Toggle bold'});
  expect(screen.getByRole('button',{name:'Toggle italic'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'Insert link'})).toBeTruthy();
  // Its classes are the kit's: no size steppers, colour or layout to write into them.
  expect(screen.queryByRole('button',{name:'Decrease font size'})).toBeNull();
  expect(screen.queryByRole('textbox',{name:'Text color'})).toBeNull();
  expect(screen.queryByRole('note',{name:'Why this text is not editable'})).toBeNull();

  page.emit({type:'mx:selection',selection:LOCKED});
  expect((await screen.findByRole('note',{name:'Why this text is not editable'})).textContent).toBe('Text comes from data');
  expect(screen.queryByRole('button',{name:'Toggle bold'})).toBeNull();

  page.emit({type:'mx:text-edit',path:CELL,innerHtml:'<b>Thu</b>rsday'});
  // A forged edit to the data cell is refused by the same composition on both pages.
  page.emit({type:'mx:text-edit',path:DATA_CELL,innerHtml:'42'});
  expect(await page.saved()).toBe(BODY.replace('>Wed<','><b>Thu</b>rsday<'));
 });
});

/** Plain HTML: a paragraph bound to data beside a paragraph of the author's text. */
const PLAIN='<div id="m"><p id="tot">Total: {$x} items</p><p id="pl">Plain <strong id="ps">bold</strong> words</p></div>';
const BOUND='0.0',TEXT='0.1';
const BOUND_SELECTION={kind:'element',mode:'block',path:BOUND,tag:'p',nodeId:'tot',rect:RECT,className:'',style:'',ancestors:[],textLock:'Text comes from data'};

describe.each([['the hosted editor',hosted],['the local preview',preview]] as const)('a paragraph bound to data in %s',(_name,open)=>{
 it('says why it takes no caret, refuses its rendered value, and saves the text beside it with the binding intact',async()=>{
  const page=await open(PLAIN);
  page.emit({type:'mx:selection',selection:BOUND_SELECTION});
  expect((await screen.findByRole('note',{name:'Why this text is not editable'})).textContent).toBe('Text comes from data');
  // The rendered value typed over the binding (what the editor saved before the rule), and a mark addressed alone.
  page.emit({type:'mx:text-edit',path:BOUND,innerHtml:'Total: 42 items total'});
  page.emit({type:'mx:text-edit',path:`${TEXT}.1`,innerHtml:'forged'});
  page.emit({type:'mx:text-edit',path:TEXT,innerHtml:'Plain <strong id="ps">bold</strong> words, edited'});
  expect(await page.saved()).toBe(PLAIN.replace('words</p>','words, edited</p>'));
 });
});
