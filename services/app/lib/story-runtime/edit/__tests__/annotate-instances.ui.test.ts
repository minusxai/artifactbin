/**
 * COMMENTING ON A RUNTIME INSTANCE, and on a managed iframe's own DOM: the
 * exact typed row behind a cell, and the child-owned paint and geometry a
 * managed document reports up for a selection the parent cannot see.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { connectManagedComments } from '@/lib/story-runtime/managed-comment-host';
import type { ManagedCommentState } from '@/lib/story-runtime/managed-comment-contract';
import { STORY_SELECTION_MESSAGE, type StoryAnnotationsMessage, type StoryEditSelection } from '@/lib/story-runtime/contract';
import { disposeAnnotateSession, env, installAnnotateSession, layouts, rectOf, state } from '@/test/helpers/annotate-session';

beforeEach(installAnnotateSession);
afterEach(disposeAnnotateSession);

describe('runtime instance targeting', () => {
  it('resolves the exact typed row and falls back to owner after removal', () => {
    document.body.innerHTML='<div id="table" data-mx-ast="0"><table><tbody><tr><td id="cell">Alice</td><td id="other">Bob</td></tr></tbody></table></div>';
    const target={kind:'table' as const,rowKey:1,columnKey:'name'};
    const cell=document.getElementById('cell')!;cell.setAttribute('data-mx-comment-owner','table');cell.setAttribute('data-mx-comment-target',JSON.stringify(target));
    const other=document.getElementById('other')!;other.setAttribute('data-mx-comment-owner','table');other.setAttribute('data-mx-comment-target',JSON.stringify({...target,rowKey:'1'}));
    vi.spyOn(cell,'getBoundingClientRect').mockReturnValue({x:10,y:20,width:30,height:40} as DOMRect);
    const parsed=parseJsxOrThrow('<DataTable id="table" rows={[]} />');env.session.setNodes(parsed.nodes);
    const message:StoryAnnotationsMessage={...state('on'),pins:[{id:'cell-comment',path:'0',key:'table',nodeId:'table',range:{v:1,kind:'target',target}}]};
    env.session.update(message);
    expect(layouts().at(-1)).toMatchObject({positions:[{id:'cell-comment',status:'exact',rect:{x:10,y:20}}]});
    expect(cell).toHaveAttribute('data-mx-annotated');expect(other).not.toHaveAttribute('data-mx-annotated');
    cell.remove();env.session.update(message);
    expect(layouts().at(-1)).toMatchObject({positions:[{id:'cell-comment',status:'missing'}]});
    expect(document.getElementById('table')).toHaveAttribute('data-mx-annotated');expect(other).not.toHaveAttribute('data-mx-annotated');
  });
});

it('replays iframe selection and preserves inner geometry when composer state returns', () => {
  document.body.innerHTML='<div id="frame" data-mx-ast="0" data-mx-managed-frame=""><div id="inner"></div></div>';
  const owner=document.getElementById('frame')!;
  vi.spyOn(owner,'getBoundingClientRect').mockReturnValue({x:100,y:200,width:400,height:300} as DOMRect);
  const parsed=parseJsxOrThrow('<Iframe id="frame"><p id="static">Static</p></Iframe>');env.session.setNodes(parsed.nodes);
  env.session.update({...state('on'),pins:[],pick:'select'});
  const states:ManagedCommentState[]=[];
  const host=connectManagedComments(document.getElementById('inner')!, (state)=>states.push(state));
  const generation=states.at(-1)!.generation;
  host.receive({type:'comment-selection',generation,selection:{target:{kind:'key',path:['row']},rect:{x:10,y:20,width:50,height:30}}});
  const selected=env.posted.filter((message)=>message.type===STORY_SELECTION_MESSAGE).at(-1)!.selection as StoryEditSelection;
  expect(selected).toMatchObject({nodeId:'frame',rect:{x:110,y:220},range:{kind:'target',target:{kind:'iframe',node:{kind:'key',path:['row']}}}});
  env.session.update({...state('on'),pins:[],selectedPath:'0',selected});
  expect(states.at(-1)?.selection).toMatchObject({target:{kind:'key',path:['row']},rect:{x:10,y:20}});
  const count=env.posted.filter((message)=>message.type===STORY_SELECTION_MESSAGE).length;
  host.receive({type:'comment-selection',generation,selection:{target:{kind:'source',id:'foreign'},rect:{x:0,y:0,width:10,height:10}}});
  expect(env.posted.filter((message)=>message.type===STORY_SELECTION_MESSAGE)).toHaveLength(count);
  host.dispose();
});

it('opens a composer for an iframe text Comment action outside Select mode without reopening on layout', () => {
  document.body.innerHTML='<div id="frame" data-mx-ast="0" data-mx-managed-frame=""></div>';
  const owner=document.getElementById('frame')!;
  vi.spyOn(owner,'getBoundingClientRect').mockReturnValue({x:100,y:200,width:400,height:300} as DOMRect);
  const parsed=parseJsxOrThrow('<Iframe id="frame"><p id="static">Static</p></Iframe>');env.session.setNodes(parsed.nodes);
  env.session.update({...state('on'),pins:[],pick:null,canComment:true});
  const states:ManagedCommentState[]=[];const host=connectManagedComments(owner,(state)=>states.push(state));
  const generation=states.at(-1)!.generation;
  const range={v:1,parts:[{rel:'',start:0,end:6,text:'Static'}]};
  host.receive({type:'comment-selection',generation,selection:{target:{kind:'source',id:'static'},quote:'Static',range,rect:{x:10,y:20,width:50,height:30}}});
  const actions=()=>env.posted.filter((message)=>message.type==='mx:selection-action');
  expect(actions()).toHaveLength(1);
  expect(actions()[0]).toMatchObject({action:'annotate',selection:{nodeId:'frame',quote:'Static',range:{kind:'target',range}}});
  host.receive({type:'comment-layout',generation,positions:[],selectionTarget:{kind:'source',id:'static'},selectionRect:{x:20,y:30,width:50,height:30}});
  expect(actions()).toHaveLength(1);
  expect(env.posted.filter((message)=>message.type===STORY_SELECTION_MESSAGE).at(-1)).toMatchObject({selection:{rect:{x:120,y:230}}});
  env.session.update({...state('on'),pins:[],canComment:false});
  host.receive({type:'comment-selection',generation,selection:{target:{kind:'source',id:'static'},rect:{x:10,y:20,width:50,height:30}}});
  expect(actions()).toHaveLength(1);
  host.dispose();
});

it('delegates exact iframe pin paint to the child and restores owner paint when missing', () => {
  document.body.innerHTML='<div id="frame" data-mx-ast="0" data-mx-managed-frame=""></div>';
  const owner=document.getElementById('frame')!;
  vi.spyOn(owner,'getBoundingClientRect').mockReturnValue({x:100,y:200,width:400,height:300} as DOMRect);
  const parsed=parseJsxOrThrow('<Iframe id="frame"><p id="static">Static</p></Iframe>');env.session.setNodes(parsed.nodes);
  const message:StoryAnnotationsMessage={...state('on'),pins:[{id:'inside',path:'0',key:'frame',nodeId:'frame',range:{v:1,kind:'target',target:{kind:'iframe',node:{kind:'source',id:'static'}}}}],openId:'inside',hoverId:'inside'};
  env.session.update(message);
  let generation='';const host=connectManagedComments(owner,(state)=>{generation=state.generation;});
  expect(owner).toHaveAttribute('data-mx-annotated');
  host.receive({type:'comment-layout',generation,positions:[{id:'inside',status:'exact',rect:{x:10,y:20,width:50,height:30}}]});
  expect(owner).not.toHaveAttribute('data-mx-annotated');
  expect(owner).not.toHaveAttribute('data-mx-annotation-open');
  expect(owner).not.toHaveAttribute('data-mx-annotation-hover');
  expect(layouts().at(-1)).toMatchObject({positions:[{id:'inside',status:'exact',rect:{x:110,y:220}}]});
  host.receive({type:'comment-layout',generation,positions:[{id:'inside',status:'missing',rect:{x:0,y:0,width:0,height:0}}]});
  expect(owner).toHaveAttribute('data-mx-annotated');
  expect(owner).toHaveAttribute('data-mx-annotation-open');
  expect(owner).toHaveAttribute('data-mx-annotation-hover');
  host.dispose();
});

it('retains ordinary area refinement in geometry reports for the same owner', () => {
  document.body.innerHTML='<section id="section" data-mx-ast="0"></section>';
  const owner=document.getElementById('section')!;
  rectOf(owner,{x:20,y:40,width:200,height:100});
  const parsed=parseJsxOrThrow('<section id="section" />');env.session.setNodes(parsed.nodes);
  const range={v:1 as const,kind:'area' as const,box:{x:0.1,y:0.2,w:0.5,h:0.4}};
  env.session.update({...state('on'),pins:[],selectedPath:'0',selected:{kind:'element',path:'0',nodeId:'section',tag:'section',rect:{x:0,y:0,width:200,height:100},className:'',style:'',ancestors:[],range}});
  expect(env.posted.filter((message)=>message.type===STORY_SELECTION_MESSAGE).at(-1)).toMatchObject({selection:{nodeId:'section',range,rect:{x:20,y:40}}});
});

it('keeps sidebar block picking distinct from explicit iframe Select mode', () => {
  document.body.innerHTML='<div id="frame" data-mx-ast="0" data-mx-managed-frame=""></div>';
  const parsed=parseJsxOrThrow('<Iframe id="frame"><p id="static">Static</p></Iframe>'); env.session.setNodes(parsed.nodes);
  const states:ManagedCommentState[]=[];
  const host=connectManagedComments(document.getElementById('frame')!,next=>states.push(next));
  env.session.update({...state('on'),pins:[],pick:'block'});
  expect(states.at(-1)).toMatchObject({picking:false,blockPicking:true});
  env.session.update({...state('on'),pins:[],pick:'select'});
  expect(states.at(-1)).toMatchObject({picking:true,blockPicking:false});
  env.session.update({...state('on'),pins:[],pick:null});
  expect(states.at(-1)).toMatchObject({picking:false,blockPicking:false,selection:null});
  host.dispose();
});

it('does not let a previous iframe draft geometry finish a fresh Select or replace a second comment', () => {
  document.body.innerHTML='<div id="frame" data-mx-ast="0" data-mx-managed-frame=""></div>';
  const owner=document.getElementById('frame')!;rectOf(owner,{x:100,y:200,width:400,height:300});
  const parsed=parseJsxOrThrow('<Iframe id="frame"><p id="static">Static</p></Iframe>');env.session.setNodes(parsed.nodes);
  const selected:StoryEditSelection={kind:'embed',path:'0',nodeId:'frame',tag:'Iframe',rect:{x:110,y:220,width:50,height:30},className:'',style:'',ancestors:[],range:{v:1,kind:'target',target:{kind:'iframe',node:{kind:'key',path:['first']}}}};
  env.session.update({...state('on'),pins:[],selectedPath:'0',selected,pick:null});
  const states:ManagedCommentState[]=[];const host=connectManagedComments(owner,next=>states.push(next));const generation=states.at(-1)!.generation;
  env.posted=[];
  env.session.update({...state('on'),pins:[],selectedPath:'0',selected,pick:'select'});
  expect(states.at(-1)?.selection).toBeNull();
  host.receive({type:'comment-layout',generation,positions:[],selectionTarget:{kind:'key',path:['first']},selectionRect:{x:10,y:20,width:50,height:30}});
  expect(env.posted.filter(message=>message.type===STORY_SELECTION_MESSAGE)).toHaveLength(0);
  host.receive({type:'comment-selection',generation,selection:{target:{kind:'key',path:['second']},rect:{x:50,y:60,width:50,height:30}}});
  expect(env.posted.filter(message=>message.type===STORY_SELECTION_MESSAGE).at(-1)).toMatchObject({selection:{range:{target:{node:{path:['second']}}}}});
  const second=env.posted.filter(message=>message.type===STORY_SELECTION_MESSAGE).at(-1)!.selection as StoryEditSelection;
  env.session.update({...state('on'),pins:[],selectedPath:'0',selected:second,pick:null});
  env.posted=[];
  host.receive({type:'comment-layout',generation,positions:[],selectionTarget:{kind:'key',path:['first']},selectionRect:{x:1,y:2,width:50,height:30}});
  expect(env.posted.filter(message=>message.type===STORY_SELECTION_MESSAGE)).toHaveLength(0);
  host.receive({type:'comment-layout',generation,positions:[],selectionTarget:{kind:'key',path:['second']},selectionRect:{x:70,y:80,width:50,height:30}});
  expect(env.posted.filter(message=>message.type===STORY_SELECTION_MESSAGE).at(-1)).toMatchObject({selection:{rect:{x:170,y:280},range:{target:{node:{path:['second']}}}}});
  env.session.update({...state('on'),pins:[],selectedPath:null,selected:null,pick:null,openId:'saved-second'});
  expect(states.at(-1)?.selection).toBeNull();
  env.posted=[];
  host.receive({type:'comment-layout',generation,positions:[],selectionTarget:{kind:'key',path:['first']},selectionRect:{x:10,y:20,width:50,height:30}});
  expect(env.posted.filter(message=>message.type===STORY_SELECTION_MESSAGE)).toHaveLength(0);
  host.receive({type:'comment-selection',generation,selection:{target:{kind:'key',path:['third']},rect:{x:80,y:90,width:50,height:30}}});
  expect(env.posted.filter(message=>message.type==='mx:selection-action').at(-1)).toMatchObject({action:'annotate',selection:{range:{target:{node:{path:['third']}}}}});
  host.dispose();
});
