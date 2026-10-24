/* @jsxImportSource solid-js */
import {createSignal} from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { StoryController } from '@/lib/story-runtime/contract';
import { render } from '../../__tests__/helpers';
import { SelectionActions } from '../SelectionActions';

it('grants only view mode capabilities and rechecks the requested action', () => {
  const send = vi.fn(); let receive: ((data: unknown) => void) | undefined;
  const controller = { send, subscribe: (callback: (data: unknown) => void) => { receive = callback; return () => {}; } } as unknown as StoryController;
  const annotate = vi.fn();
  const selection = { kind: 'text', path: '0', nodeId: 'n1', tag: 'p', rect: { x: 0, y: 0, width: 1, height: 1 }, className: '', style: '', ancestors: [] };
  render(() => <SelectionActions runtimeRef={{ current: controller }} nonce="private" canAnnotate onAnnotate={annotate} onSelect={() => {}} />);
  expect(send).toHaveBeenCalledWith({ type: 'mx:selection-actions', edit: false, annotate: true });
  receive?.({ type: 'mx:selection-action', nonce: 'private', action: 'edit', selection });
  receive?.({ type: 'mx:selection-action', nonce: 'wrong', action: 'annotate', selection });
  expect(annotate).not.toHaveBeenCalled();
  receive?.({ type: 'mx:selection-action', nonce: 'private', action: 'annotate', selection });
  expect(annotate).toHaveBeenCalledWith(selection);
});

it('admits Select through the same live capability and nonce checks before lazy discussion exists',()=>{
 const [allowed,setAllowed]=createSignal(true);let receive:((data:unknown)=>void)|undefined;const select=vi.fn();
 const controller={send:vi.fn(),subscribe:(callback:(data:unknown)=>void)=>{receive=callback;return()=>{}}} as unknown as StoryController;
 render(()=><SelectionActions runtimeRef={{current:controller}} nonce="private" canAnnotate={allowed()} onAnnotate={()=>{}} onSelect={select}/>);
 const event={type:'mx:selection-action',nonce:'private',action:'select',selection:{kind:'text',path:'0',nodeId:'target',tag:'p',rect:{x:0,y:0,width:1,height:1},className:'',style:'',ancestors:[]}};
 receive?.({...event,nonce:'wrong'});expect(select).not.toHaveBeenCalled();receive?.(event);expect(select).toHaveBeenCalledOnce();setAllowed(false);receive?.(event);expect(select).toHaveBeenCalledOnce();
});
