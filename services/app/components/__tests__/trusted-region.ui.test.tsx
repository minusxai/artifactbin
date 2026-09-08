import {act, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {TrustedRegion} from '../TrustedRegion';

afterEach(()=>vi.useRealTimers());
it('keeps the public fallback powerless and accepts only its own trusted ready/size message',()=>{
  const workspace=vi.fn();
  const {container}=render(<TrustedRegion kind="home" page="/" controls="https://i.example.test" fallback={<button aria-label="Start placeholder">Start</button>} onWorkspace={workspace}/>);
  const frame=container.querySelector('iframe')!;
  const send=(origin:string,source:MessageEventSource|null,data:unknown)=>act(()=>window.dispatchEvent(new MessageEvent('message',{origin,source,data})));
  expect(screen.getByLabelText('Start placeholder').closest('[inert]')).toBeTruthy();
  expect(frame).toHaveAttribute('aria-hidden','true');
  const data={type:'mx:region:ready',height:350,workspace:false};
  send('null',frame.contentWindow,data);send('https://i.example.test',window,data);
  expect(workspace).not.toHaveBeenCalled();
  send('https://i.example.test',frame.contentWindow,data);
  expect(frame).toHaveStyle({height:'350px'});
  expect(frame).not.toHaveAttribute('aria-hidden');
  expect(screen.queryByLabelText('Start placeholder')).toBeNull();
  expect(workspace).toHaveBeenCalledWith(false);
  send('https://i.example.test',frame.contentWindow,{...data,height:Infinity});
  expect(frame).toHaveStyle({height:'350px'});
});
it('bounds the private workspace to the visible viewport instead of centering dialogs in a tall document',()=>{
  const {container}=render(<TrustedRegion kind="home" page="/" controls="https://i.example.test" fallback={<span>Home</span>}/>);
  const frame=container.querySelector('iframe')!;
  act(()=>window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,origin:'https://i.example.test',data:{type:'mx:region:ready',height:18000,workspace:true}})));
  expect(frame.style.height).toBe('calc(100dvh - 44px)');
});
it('shows a reachable retry when the trusted region never becomes ready',()=>{
  vi.useFakeTimers();
  const {container}=render(<TrustedRegion kind="home" page="/" controls="https://i.example.test" fallback={<span>Public fallback</span>}/>);
  act(()=>vi.advanceTimersByTime(15000));
  expect(screen.getByLabelText('Retry loading home')).toBeEnabled();
  fireEvent.click(screen.getByLabelText('Retry loading home'));
  expect(screen.queryByLabelText('Retry loading home')).toBeNull();
  expect(container.querySelector('iframe')).toHaveAttribute('aria-hidden','true');
  act(()=>vi.advanceTimersByTime(15000));
  expect(screen.getByLabelText('Retry loading home')).toBeEnabled();
});
it('replaces the frame and rejects stale readiness when its public page changes',()=>{
  const view=(page:`/@${string}`)=><TrustedRegion kind="follow" page={page} controls="https://i.example.test" fallback={<button aria-label="Follow placeholder">follow</button>}/>;
  const {container,rerender}=render(view('/@alice'));
  const old=container.querySelector('iframe')!;const source=old.contentWindow;
  act(()=>window.dispatchEvent(new MessageEvent('message',{origin:'https://i.example.test',source,data:{type:'mx:region:ready',height:44}})));
  rerender(view('/@bob'));
  expect(container.querySelector('iframe')).not.toBe(old);
  expect(container.querySelector('iframe')).toHaveAttribute('tabindex','-1');
  act(()=>window.dispatchEvent(new MessageEvent('message',{origin:'https://i.example.test',source,data:{type:'mx:region:ready',height:44}})));
  expect(screen.getByLabelText('Follow placeholder')).toBeInTheDocument();
});
it('keeps chrome layout space and isolates the public page while a trusted modal is open',()=>{
  const {container}=render(<><button aria-label="Public action">Public</button><TrustedRegion kind="chrome" page="/" controls="https://i.example.test" fallback={<div>Chrome</div>}/><iframe title="Sibling private region"/></>);
  const frame=container.querySelector('iframe')!;const action=screen.getByLabelText('Public action');action.focus();
  const send=(modal:boolean)=>act(()=>window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,origin:'https://i.example.test',data:{type:'mx:controls:regions',modal,rects:[{x:0,y:0,width:100,height:44}]}})));
  send(true);
  expect(action.inert).toBe(true);expect(container.querySelector('iframe[title="Sibling private region"]')).toHaveProperty('inert',true);
  expect(container.querySelector('[data-trusted-region="chrome"]')).toHaveStyle({height:'44px'});
  send(false);expect(action.inert).toBe(false);expect(document.activeElement).toBe(action);
});
it('accepts appearance only from the chrome frame and forwards the current hash after navigation',()=>{
  const {container}=render(<TrustedRegion kind="chrome" page="/" controls="https://i.example.test" fallback={<span>Chrome</span>}/>);
  const frame=container.querySelector('iframe')!;
  const post=vi.spyOn(frame.contentWindow!,'postMessage');
  act(()=>window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,origin:'https://i.example.test',data:{type:'mx:page:ready'}})));
  expect(post).toHaveBeenCalledWith({type:'mx:region:measure'},'https://i.example.test');
  const message={type:'mx:region:appearance',mode:'dark'};
  act(()=>window.dispatchEvent(new MessageEvent('message',{source:window,origin:'https://i.example.test',data:message})));
  expect(document.documentElement.dataset.theme).not.toBe('dark');
  act(()=>window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,origin:'https://i.example.test',data:message})));
  expect(document.documentElement.dataset.theme).toBe('dark');
  fireEvent.load(frame);window.history.replaceState(null,'','/#second');
  act(()=>window.dispatchEvent(new Event('hashchange')));
  expect(post).toHaveBeenCalledWith({type:'mx:page:hash',hash:'#second'},'https://i.example.test');
  delete document.documentElement.dataset.theme;
});
