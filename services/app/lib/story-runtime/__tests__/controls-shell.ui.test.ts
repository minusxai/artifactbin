import {afterEach,expect,it,vi} from 'vitest';
import {installControlsShell} from '../../../web/controls-shell';

let dispose: (()=>void)|undefined;
afterEach(()=>{dispose?.();dispose=undefined;document.body.replaceChildren();vi.restoreAllMocks();vi.useRealTimers();});
function setup() {
  vi.useFakeTimers();
  vi.spyOn(Element.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,width:100,height:40,top:0,left:0,right:100,bottom:40,toJSON:()=>({})});
  const post=vi.spyOn(window.parent,'postMessage');
  dispose=installControlsShell(location.origin);
  return post;
}
it('reports nonmodal half sheets without blocking the viewport and installs isolated no-motion policy',()=>{
  const post=setup();document.body.innerHTML='<div role="dialog"><button>Close</button></div>';
  vi.advanceTimersByTime(300);
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({modal:false}),location.origin);
  expect(document.head.textContent).toContain('animation:none!important');
  dispose?.();dispose=undefined;expect(document.head.textContent).not.toContain('animation:none!important');
});
it('focuses a real modal, wraps Tab both ways, and restores the opener',()=>{
  document.body.innerHTML='<button id="opener">Open</button>';
  const opener=document.getElementById('opener')!;opener.focus();
  const post=setup();
  const modal=document.createElement('div');modal.setAttribute('aria-modal','true');modal.innerHTML='<button id="first">First</button><button id="last">Last</button>';document.body.append(modal);
  vi.advanceTimersByTime(300);
  expect(document.activeElement?.id).toBe('first');
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({modal:true}),location.origin);
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,cancelable:true}));expect(document.activeElement?.id).toBe('last');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',cancelable:true}));expect(document.activeElement?.id).toBe('first');
  modal.remove();vi.advanceTimersByTime(300);expect(document.activeElement).toBe(opener);
});
it('rejects forged Escape messages and accepts only the exact parent and origin',()=>{
  setup();const key=vi.fn();document.addEventListener('keydown',key);
  const send=(source:MessageEventSource|null,origin:string)=>window.dispatchEvent(new MessageEvent('message',{source,origin,data:{type:'mx:controls:escape'}}));
  send(null,location.origin);send(window.parent,'https://evil.test');expect(key).not.toHaveBeenCalled();
  send(window.parent,location.origin);expect(key).toHaveBeenCalledTimes(1);
  document.removeEventListener('keydown',key);
});
