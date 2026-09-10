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
