import { afterEach, expect, it, vi } from 'vitest';
import { createManagedCommentRuntime } from '../managed-comment-runtime';
afterEach(() => { document.body.replaceChildren(); });
it('receives select mode and reports keyed dynamic children without choosing an owner', () => {
  const send = vi.fn();
  const runtime = createManagedCommentRuntime(window, send);
  runtime.update({type:'comment-state',generation:'mount-a',enabled:true,picking:true,canComment:true,pins:[],openId:null,hoverId:null,selection:null});
  document.body.innerHTML='<div data-comment-key="order:123"><p data-comment-key="customer">Alice</p></div>';
  const node=document.querySelector('p')!;
  node.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
  node.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
  expect(send).toHaveBeenCalledWith(expect.objectContaining({type:'comment-selection',generation:'mount-a',selection:expect.objectContaining({target:{kind:'key',path:['order:123','customer']}})}));
  runtime.dispose();
  send.mockClear();
  node.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  expect(send).not.toHaveBeenCalled();
});

it('marks comment targets, detects duplicate keys and restores highlights after keyed replacement', () => {
  const send=vi.fn();document.body.innerHTML='<div data-comment-key="order"><p data-comment-key="customer">Alice</p></div>';
  const runtime=createManagedCommentRuntime(window,send);
  const state={type:'comment-state' as const,generation:'a',enabled:true,picking:false,canComment:true,pins:[{id:'pin',target:{kind:'key' as const,path:['order','customer']}}],openId:'pin',hoverId:null,selection:null};
  runtime.update(state);
  expect(document.querySelector('p')).toHaveAttribute('data-mx-annotation-open');
  document.querySelector('div')!.insertAdjacentHTML('beforeend','<p data-comment-key="customer">Other</p>');runtime.update(state);
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({positions:[expect.objectContaining({status:'ambiguous'})]}));
  document.querySelector('div')!.innerHTML='<p data-comment-key="customer">Restored</p>';runtime.update(state);
  expect(document.querySelector('p')).toHaveAttribute('data-mx-annotation-open');
  runtime.dispose();expect(document.querySelector('p')).not.toHaveAttribute('data-mx-annotation-open');
});
it('keeps session IDs only on existing nodes and rejects a prior generation',()=>{
  const send=vi.fn();document.body.innerHTML='<p>Alice</p>';
  const runtime=createManagedCommentRuntime(window,send);
  const state={type:'comment-state' as const,generation:'a',enabled:true,picking:true,canComment:true,pins:[],openId:null,hoverId:null,selection:null};
  runtime.update(state);document.querySelector('p')!.click();
  const selection=send.mock.calls.find(c=>c[0].type==='comment-selection')![0].selection;
  expect(selection.target).toMatchObject({kind:'session',generation:'a'});
  document.querySelector('p')!.outerHTML='<p>Alice</p>';
  runtime.update({...state,pins:[{id:'p',target:selection.target}]});
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({positions:[expect.objectContaining({status:'missing'})]}));runtime.dispose();
});
it('does not intercept authored controls when disabled or without permission',()=>{
  const send=vi.fn();document.body.innerHTML='<button>Action</button>';const runtime=createManagedCommentRuntime(window,send);
  runtime.update({type:'comment-state',generation:'a',enabled:true,picking:true,canComment:false,pins:[],openId:null,hoverId:null,selection:null});
  const click=new MouseEvent('click',{bubbles:true,cancelable:true});document.querySelector('button')!.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(false);expect(send.mock.calls.some(c=>c[0].type==='comment-selection')).toBe(false);runtime.dispose();
});
it('draws area refinements and offers Select from text and context actions',()=>{
  document.body.innerHTML='<p id="source">Alice hello</p>';
  const node=document.querySelector('p')!;vi.spyOn(node,'getBoundingClientRect').mockReturnValue({x:0,y:0,width:100,height:100,top:0,left:0,right:100,bottom:100,toJSON(){}});
  const send=vi.fn(),runtime=createManagedCommentRuntime(window,send);
  const state={type:'comment-state' as const,generation:'a',enabled:true,picking:true,canComment:true,pins:[],openId:null,hoverId:null,selection:null};runtime.update(state);
  node.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:10,clientY:10}));
  node.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:50,clientY:40}));
  expect(send).toHaveBeenCalledWith(expect.objectContaining({type:'comment-selection',selection:expect.objectContaining({target:{kind:'source',id:'source'},range:{v:1,kind:'area',box:{x:.1,y:.1,w:.4,h:.3}}})}));
  runtime.update({...state,picking:false});
  node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:10,clientY:20}));
  const select=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Select')!;select.click();
  expect(send).toHaveBeenCalledWith({type:'comment-select-mode',generation:'a'});
  runtime.update({...state,picking:false});
  const range=document.createRange();range.setStart(node.firstChild!,0);range.setEnd(node.firstChild!,5);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));
  Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Comment')!.click();
  expect(send).toHaveBeenCalledWith(expect.objectContaining({type:'comment-selection',selection:expect.objectContaining({quote:'Alice',range:{v:1,parts:[{rel:'',start:0,end:5,text:'Alice'}]}})}));runtime.dispose();window.getSelection()!.removeAllRanges();
});
it('offers comment actions on touch long press and cancels on movement',()=>{
  vi.useFakeTimers();document.body.innerHTML='<p>Touch target</p>';const node=document.querySelector('p')!,runtime=createManagedCommentRuntime(window,vi.fn());
  runtime.update({type:'comment-state',generation:'a',enabled:true,picking:false,canComment:true,pins:[],openId:null,hoverId:null,selection:null});
  const down=new MouseEvent('pointerdown',{bubbles:true,clientX:10,clientY:10});Object.defineProperty(down,'pointerType',{value:'touch'});node.dispatchEvent(down);vi.advanceTimersByTime(550);
  expect(Array.from(document.querySelectorAll('button')).map(b=>b.textContent)).toEqual(['Comment','Select']);
  node.dispatchEvent(down);node.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:50,clientY:10}));vi.advanceTimersByTime(550);expect(document.querySelector('button')).toBeNull();runtime.dispose();vi.useRealTimers();
});
