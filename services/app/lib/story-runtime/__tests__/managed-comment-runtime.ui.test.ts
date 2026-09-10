import { COMMENT_PRESENTATION } from '../comment-presentation';
import { afterEach, expect, it, vi } from 'vitest';
import { createManagedCommentRuntime } from '../managed-comment-runtime';
afterEach(() => { document.body.replaceChildren(); });
it('receives select mode and reports keyed dynamic children without choosing an owner', () => {
  const send = vi.fn();
  const runtime = createManagedCommentRuntime(window, send, COMMENT_PRESENTATION);
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
  const runtime=createManagedCommentRuntime(window,send,COMMENT_PRESENTATION);
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
  const runtime=createManagedCommentRuntime(window,send,COMMENT_PRESENTATION);
  const state={type:'comment-state' as const,generation:'a',enabled:true,picking:true,canComment:true,pins:[],openId:null,hoverId:null,selection:null};
  runtime.update(state);document.querySelector('p')!.click();
  const selection=send.mock.calls.find(c=>c[0].type==='comment-selection')![0].selection;
  expect(selection.target).toMatchObject({kind:'session',generation:'a'});
  document.querySelector('p')!.outerHTML='<p>Alice</p>';
  runtime.update({...state,pins:[{id:'p',target:selection.target}]});
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({positions:[expect.objectContaining({status:'missing'})]}));runtime.dispose();
});
it('does not intercept authored controls when disabled or without permission',()=>{
  const send=vi.fn();document.body.innerHTML='<button>Action</button>';const runtime=createManagedCommentRuntime(window,send,COMMENT_PRESENTATION);
  runtime.update({type:'comment-state',generation:'a',enabled:true,picking:true,canComment:false,pins:[],openId:null,hoverId:null,selection:null});
  const click=new MouseEvent('click',{bubbles:true,cancelable:true});document.querySelector('button')!.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(false);expect(send.mock.calls.some(c=>c[0].type==='comment-selection')).toBe(false);runtime.dispose();
});
it('draws area refinements and offers Select from text and context actions',()=>{
  document.body.innerHTML='<p id="source">Alice hello</p>';
  const node=document.querySelector('p')!;vi.spyOn(node,'getBoundingClientRect').mockReturnValue({x:0,y:0,width:100,height:100,top:0,left:0,right:100,bottom:100,toJSON(){}});
  const send=vi.fn(),runtime=createManagedCommentRuntime(window,send,COMMENT_PRESENTATION);
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
  Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Comment on selected text')!.click();
  expect(send).toHaveBeenCalledWith(expect.objectContaining({type:'comment-selection',selection:expect.objectContaining({quote:'Alice',range:{v:1,parts:[{rel:'',start:0,end:5,text:'Alice'}]}})}));runtime.dispose();window.getSelection()!.removeAllRanges();
});
it('offers comment actions on touch long press and cancels on movement',()=>{
  vi.useFakeTimers();document.body.innerHTML='<p>Touch target</p>';const node=document.querySelector('p')!,runtime=createManagedCommentRuntime(window,vi.fn(),COMMENT_PRESENTATION);
  runtime.update({type:'comment-state',generation:'a',enabled:true,picking:false,canComment:true,pins:[],openId:null,hoverId:null,selection:null});
  const down=new MouseEvent('pointerdown',{bubbles:true,clientX:10,clientY:10});Object.defineProperty(down,'pointerType',{value:'touch'});node.dispatchEvent(down);vi.advanceTimersByTime(550);
  expect(Array.from(document.querySelectorAll('button')).map(b=>b.textContent)).toEqual(['Select']);
  node.dispatchEvent(down);node.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:50,clientY:10}));vi.advanceTimersByTime(550);expect(document.querySelector('button')).toBeNull();runtime.dispose();vi.useRealTimers();
});
it('restores touch styles, clears hover on leaving and cancels an in-progress gesture',()=>{
  document.body.innerHTML='<p>Touch</p>';document.body.style.setProperty('touch-action','pan-y');
  const node=document.querySelector('p')!,send=vi.fn(),runtime=createManagedCommentRuntime(window,send,COMMENT_PRESENTATION);
  const state={type:'comment-state' as const,generation:'a',enabled:true,picking:true,canComment:true,pins:[],openId:null,hoverId:null,selection:null};runtime.update(state);
  expect(document.body.style.getPropertyValue('touch-action')).toBe('none');
  node.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));runtime.update(state);expect(node).toHaveAttribute('data-mx-annotate-pick-hover');
  node.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:null}));runtime.update(state);expect(node).not.toHaveAttribute('data-mx-annotate-pick-hover');
  node.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:10,clientY:10}));node.dispatchEvent(new Event('pointercancel',{bubbles:true}));node.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:50,clientY:50}));
  expect(send.mock.calls.some(c=>c[0].type==='comment-selection')).toBe(false);
  runtime.update({...state,picking:false});expect(document.body.style.getPropertyValue('touch-action')).toBe('pan-y');
  runtime.update(state);runtime.dispose();expect(document.body.style.getPropertyValue('touch-action')).toBe('pan-y');document.body.removeAttribute('style');
});
it('does not claim script-created IDs as saved source IDs',()=>{
  document.body.innerHTML='<p id="saved">Static</p>';const send=vi.fn(),runtime=createManagedCommentRuntime(window,send,COMMENT_PRESENTATION);
  runtime.update({type:'comment-state',generation:'a',enabled:true,picking:true,canComment:true,pins:[],openId:null,hoverId:null,selection:null});
  document.body.insertAdjacentHTML('beforeend','<p id="dynamic">New</p>');document.getElementById('dynamic')!.click();
  expect(send.mock.calls.find(c=>c[0].type==='comment-selection')![0].selection.target).toMatchObject({kind:'session'});runtime.dispose();
});
it('falls back to the node for duplicate quotes instead of guessing a text occurrence',()=>{
  document.body.innerHTML='<p id="saved">Alice Alice</p>';const node=document.querySelector('p')!;
  vi.spyOn(node,'getBoundingClientRect').mockReturnValue({x:0,y:0,width:100,height:40,top:0,left:0,right:100,bottom:40,toJSON(){}});
  const original=Object.getOwnPropertyDescriptor(Range.prototype,'getClientRects');
  Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:()=>[{x:20,y:0,width:10,height:20}]});
  const runtime=createManagedCommentRuntime(window,vi.fn(),COMMENT_PRESENTATION);
  const state={type:'comment-state' as const,generation:'a',enabled:true,picking:false,canComment:true,pins:[{id:'pin',target:{kind:'source' as const,id:'saved'},range:{v:1 as const,parts:[{rel:'',start:0,end:5,text:'Alice'}]}}],openId:'pin',hoverId:null,selection:null};
  try {
    runtime.update(state);expect(node).not.toHaveAttribute('data-mx-annotation-ranged');expect(document.querySelector('[data-mx-comment-ui] > div')).toBeNull();
    node.textContent='Alice';runtime.update(state);expect((document.querySelector('[data-mx-comment-ui] > div') as HTMLElement).style.width).toBe('10px');
  }finally{runtime.dispose();if(original)Object.defineProperty(Range.prototype,'getClientRects',original);else delete (Range.prototype as unknown as Record<string,unknown>).getClientRects;}
});
it('coalesces DOM layout notifications and cancels touch long press on pointercancel',()=>{
  vi.useFakeTimers();document.body.innerHTML='<p>Touch target</p>';const send=vi.fn(),runtime=createManagedCommentRuntime(window,send,COMMENT_PRESENTATION),node=document.querySelector('p')!;
  runtime.update({type:'comment-state',generation:'a',enabled:true,picking:false,canComment:true,pins:[],openId:null,hoverId:null,selection:null});
  const down=new MouseEvent('pointerdown',{bubbles:true,clientX:10,clientY:10});Object.defineProperty(down,'pointerType',{value:'touch'});node.dispatchEvent(down);node.dispatchEvent(new Event('pointercancel',{bubbles:true}));vi.advanceTimersByTime(1000);
  expect(document.querySelector('button')).toBeNull();expect(send.mock.calls.filter(c=>c[0].type==='comment-layout').length).toBeLessThanOrEqual(2);runtime.dispose();vi.useRealTimers();
});

it('keeps a saved node comment as a tint without adding a child pin button', () => {
  document.body.innerHTML='<p id="saved">Commented text</p>';
  const runtime=createManagedCommentRuntime(window,vi.fn(),COMMENT_PRESENTATION);
  runtime.update({type:'comment-state',generation:'a',enabled:true,picking:false,canComment:true,pins:[{id:'one',target:{kind:'source',id:'saved'}}],openId:null,hoverId:null,selection:null});
  expect(document.querySelector('p')).toHaveAttribute('data-mx-annotated');
  expect(document.querySelector('[data-mx-comment-ui] button')).toBeNull();
  expect(document.querySelector('[data-mx-comment-ui] > div')).toBeNull();
  runtime.dispose();
});

it('uses the same selection menu icons and accessible labels as markup', () => {
  document.body.innerHTML='<p id="source">Select these words</p>';
  const runtime=createManagedCommentRuntime(window,vi.fn(),COMMENT_PRESENTATION);
  runtime.update({type:'comment-state',generation:'a',enabled:true,picking:false,canComment:true,pins:[],openId:null,hoverId:null,selection:null});
  const node=document.querySelector('p')!,range=document.createRange();range.selectNodeContents(node);
  window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));
  expect(document.querySelector('[aria-label="Text selection actions"] [aria-label="Comment on selected text"] .lucide-message-square')).not.toBeNull();
  expect(document.querySelector('[aria-label="Text selection actions"] [aria-label="Select"] .lucide-square-dashed-mouse-pointer')).not.toBeNull();
  runtime.dispose();window.getSelection()!.removeAllRanges();
});

it('allows a native text drag and a second block comment with the sidebar open', () => {
  document.body.innerHTML='<p id="first">First text</p><p id="second">Second text</p>';
  const send=vi.fn(),runtime=createManagedCommentRuntime(window,send,COMMENT_PRESENTATION);
  const state={type:'comment-state' as const,generation:'a',enabled:true,picking:false,blockPicking:true,canComment:true,pins:[{id:'one',target:{kind:'source' as const,id:'first'}}],openId:'one',hoverId:null,selection:null};
  runtime.update(state);
  const node=document.getElementById('second')!,down=new MouseEvent('pointerdown',{bubbles:true,cancelable:true});node.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(false);expect(document.body.style.getPropertyValue('user-select')).not.toBe('none');
  window.getSelection()!.removeAllRanges();node.click();
  expect(send).toHaveBeenCalledWith(expect.objectContaining({type:'comment-selection',selection:expect.objectContaining({target:{kind:'source',id:'second'}})}));
  runtime.update({...state,selection:null});
  const range=document.createRange();range.selectNodeContents(node);window.getSelection()!.addRange(range);send.mockClear();node.click();
  expect(send.mock.calls.some(c=>c[0].type==='comment-selection')).toBe(false);
  runtime.dispose();window.getSelection()!.removeAllRanges();
});

it('anchors a native paragraph selection before the next empty endpoint to its source node', () => {
  document.body.innerHTML='<p id="first">First paragraph</p><p id="next">Next paragraph</p>';
  const send=vi.fn(),runtime=createManagedCommentRuntime(window,send,COMMENT_PRESENTATION);
  runtime.update({type:'comment-state',generation:'a',enabled:true,picking:false,canComment:true,pins:[],openId:null,hoverId:null,selection:null});
  const range=document.createRange();range.setStart(document.getElementById('first')!.firstChild!,0);range.setEnd(document.getElementById('next')!.firstChild!,0);
  window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));
  (document.querySelector('[aria-label="Comment on selected text"]') as HTMLButtonElement).click();
  expect(send).toHaveBeenCalledWith(expect.objectContaining({type:'comment-selection',selection:expect.objectContaining({target:{kind:'source',id:'first'},quote:'First paragraph'})}));
  runtime.dispose();window.getSelection()!.removeAllRanges();
});

it('clears old native text when Select starts and offers an unchanged text selection again', () => {
  document.body.innerHTML='<p id="text">Select these words</p>';
  const runtime=createManagedCommentRuntime(window,vi.fn(),COMMENT_PRESENTATION);
  const state={type:'comment-state' as const,generation:'a',enabled:true,picking:false,canComment:true,pins:[],openId:null,hoverId:null,selection:null};
  runtime.update(state);const node=document.querySelector('p')!,range=document.createRange();range.selectNodeContents(node);
  window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));
  node.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true}));node.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  expect(document.querySelector('[aria-label="Comment on selected text"]')).not.toBeNull();
  runtime.update({...state,picking:true});
  expect(window.getSelection()!.isCollapsed).toBe(true);
  expect(document.querySelector('[aria-label="Comment on selected text"]')).toBeNull();
  runtime.dispose();
});

it('keeps the context Select menu through the release of a long press', () => {
  document.body.innerHTML='<p>Touch target</p>';const node=document.querySelector('p')!;
  const runtime=createManagedCommentRuntime(window,vi.fn(),COMMENT_PRESENTATION);
  runtime.update({type:'comment-state',generation:'a',enabled:true,picking:false,canComment:true,pins:[],openId:null,hoverId:null,selection:null});
  node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
  node.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  expect(document.querySelector('[aria-label="Document actions"] [aria-label="Select"]')).not.toBeNull();
  runtime.dispose();
});
